// Cogwild — online play: connection, Online/Room screens, and keeping a match in sync between players.
//
// Who decides what (so all games agree without a heavy game server):
//  * the HOST's game runs the bots, the rules, pickups, chests, objectives, waves and the end of the match
//  * every player's game moves its own mech/pilot and sends it 20×/s; the other games show smooth replicas
//  * the SHOOTER's game decides what its shots hit; the target's own game applies the damage and reports wrecks
(function () {
  const CW = window.CW;
  const V3 = THREE.Vector3;
  const $ = (id) => document.getElementById(id);
  const NET_VERSION = 'cogwild-net-4';
  const SEND_HZ = 20;
  const r2 = (v) => Math.round(v * 100) / 100;
  // names and texts from other players: plain short text only
  const clean = (s, n) => String(s || '').replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  CW.QUICK_CHAT = ['👋 Hi!', 'GG!', 'Nice shot!', 'Follow me!', 'Help!', 'Oops 😅', 'Ready!', 'One more?'];
  const COOP = ['solo', 'squad'];

  class Net {
    constructor(game) {
      this.game = game;
      this.ws = null;
      this.id = 0;
      this.status = 'offline';
      this.room = null;
      this.active = false; // in an online match right now
      this.isHost = false;
      this.applying = false; // true while applying a hit another player's game decided
      this.byId = new Map(); // combatant netId -> combatant
      this.events = [];
      this.hits = new Map();
      this.adds = [];
      this.sendT = 0;
      this.objT = 0;
      this.ping = 0;
      this.ready = false;
      this.bpIndex = 0;
      this.lastChat = 0;
      this.bindUi();
      setInterval(() => { if (this.ws && this.ws.readyState === 1) this.send({ t: 'ping', at: performance.now() }); }, 2000);
      setInterval(() => { if (this.room && this.game.state === 'lobby') this.renderTimer(); }, 500);
      // invite links (…?room=CODE) open the Online screen and join that room
      const code = new URLSearchParams(location.search).get('room');
      if (code) setTimeout(() => this.openOnline(code), 400);
    }

    get client() { return this.active && !this.isHost; }
    owns(c) { return !this.active || !c || c.owner === this.id; }
    isRemote(c) { return this.active && !!c && c.owner !== this.id; }
    myName() { return (this.game.profile.name || '').trim() || 'Pilot' + (1000 + Math.floor(Math.random() * 9000)); }
    url() {
      if (CW.SERVER_URL) return CW.SERVER_URL;
      return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    }
    canConnect() { return !!CW.SERVER_URL || location.protocol === 'http:' || location.protocol === 'https:'; }

    // ======================= connection =======================
    connect() {
      if (this.ws && this.ws.readyState <= 1 && this.connecting) return this.connecting;
      this.setStatus('Connecting to the online server…');
      this.connecting = new Promise((resolve, reject) => {
        let ws;
        try { ws = new WebSocket(this.url()); } catch (e) { this.setStatus('offline'); reject(e); return; }
        this.ws = ws;
        const timeout = setTimeout(() => ws.close(), 9000);
        ws.onopen = () => this.send({ t: 'hello', name: this.name || (this.name = this.myName()), ver: NET_VERSION });
        ws.onmessage = (e) => {
          let m;
          try { m = JSON.parse(e.data); } catch (err) { return; }
          if (m.t === 'welcome') { clearTimeout(timeout); this.id = m.id; this.setStatus('online'); resolve(); if (this.game.account) this.game.account.onWelcome(); }
          try { this.onMessage(m); } catch (err) { console.error('net message', m.t, err); }
        };
        ws.onclose = () => {
          clearTimeout(timeout);
          const wasOnline = this.status === 'online';
          this.ws = null;
          this.connecting = null;
          this.setStatus('offline');
          reject(new Error('closed'));
          this.onDisconnect(wasOnline);
        };
      });
      this.connecting.catch(() => {});
      return this.connecting;
    }
    send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
    setStatus(s) {
      this.status = s;
      const el = $('onStatus');
      if (!el) return;
      el.textContent = s === 'online' ? `🟢 Online as ${this.name}` : s === 'offline' ? '🔴 Not connected' : s;
      el.className = 'small on-status ' + (s === 'online' ? 'ok' : s === 'offline' ? 'bad' : '');
      document.querySelectorAll('.need-online').forEach((b) => (b.disabled = s !== 'online'));
    }
    onDisconnect(wasOnline) {
      const g = this.game;
      if (g.account) g.account.onDisconnect();
      if (!wasOnline) {
        if (g.state === 'online') this.setStatus('🔴 Can\'t reach the online server. Check your internet and try again.');
        return;
      }
      const inRoom = !!this.room;
      this.room = null;
      this.building = false;
      $('netWait').classList.add('hidden');
      if (this.active || inRoom) {
        this.active = false;
        g.toast('📡 Lost connection to the online server');
        g.showMenu();
      }
    }

    // ======================= messages =======================
    onMessage(m) {
      const g = this.game;
      switch (m.t) {
        case 'room': {
          const was = this.room;
          this.room = m.room;
          this.room.bots = this.room.bots || [];
          this.roomAt = performance.now(); // the server's countdowns are counted from here
          if (!this.active) this.isHost = m.room.hostId === this.id;
          if (!was) { this.ready = !!m.room.auto; this.sendReady(); this.chatLog = []; }
          if (g.state === 'lobby') this.renderLobby();
          if (!was && g.state !== 'match') this.showLobby();
          break;
        }
        case 'rooms': this.renderRooms(m.list); break;
        case 'err':
          // the apps can't "refresh the page" to update: point them to the download page instead
          if (m.fatal && CW.APP && CW.PUBLIC_URL) {
            const msg = '⬆ A new version of Cogwild is out! Online play needs the update.';
            this.setStatus(msg);
            g.account.note(msg, [{ label: 'Download update', main: true, fn: () => window.open(CW.PUBLIC_URL + 'download.html', '_blank') }, { label: 'Later' }], 60000);
            break;
          }
          g.toast('⚠ ' + m.msg);
          if (m.fatal) this.setStatus('⚠ ' + m.msg);
          break;
        case 'kicked': this.room = null; this.stopMatch(); g.toast('You were removed from the room'); this.openOnline(); break;
        case 'pong': this.ping = Math.round(performance.now() - m.at); break;
        case 'chat': this.showChat(m.from, m.i); break;
        case 'autostart': if (this.isHost && this.room && this.room.state === 'lobby' && g.state === 'lobby' && !this.startProblem()) this.hostStart(); break;
        case 'begin': this.onBegin(m.payload); break;
        case 'st': this.onState(m); break;
        case 'left': this.onLeft(m.id); break;
        case 'hostLeft':
          if (this.active || this.building) {
            this.stopMatch();
            g.toast('The host left, so the match ended');
            this.showLobby();
          }
          break;
        default: if (g.account) g.account.onMessage(m); // accounts, friends, party, trophies
      }
    }

    // ======================= screens =======================
    bindUi() {
      $('srCancel').onclick = () => this.cancelSearch();
      $('srMech').onchange = (e) => { this.bpIndex = +e.target.value; this.sendReady(); this.renderSearch(); };
      $('onBack').onclick = () => this.game.showMenu();
      $('onCreate').onclick = () => this.withServer(() => this.send({ t: 'create', pub: $('onPublic').checked, settings: this.defaultSettings() }));
      $('onJoin').onclick = () => {
        const code = $('onCode').value.trim().toUpperCase();
        if (code.length !== 5) return this.game.toast('Room codes have 5 letters');
        this.withServer(() => this.send({ t: 'join', code }));
      };
      $('onCode').onkeydown = (e) => { if (e.key === 'Enter') $('onJoin').click(); };
      $('onRefresh').onclick = () => this.send({ t: 'list' });
      $('lbLeave').onclick = () => this.leaveRoom();
      $('lbReady').onclick = () => { this.ready = !this.ready; this.sendReady(); };
      $('lbStart').onclick = () => { const p = this.startProblem(); if (p) this.game.toast(p); else this.hostStart(); };
      $('lbCopy').onclick = () => {
        const link = this.inviteLink();
        if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => this.game.toast('🔗 Invite link copied: send it to your friends!'), () => this.game.toast(link));
        else this.game.toast(link);
      };
      $('lbMech').onchange = (e) => { this.bpIndex = +e.target.value; this.sendReady(); this.renderLobby(); };
      $('lbQuick').innerHTML = CW.QUICK_CHAT.map((t, i) => `<button class="tod-btn" data-chat="${i}">${t}</button>`).join('');
      $('lbQuick').querySelectorAll('[data-chat]').forEach((b) => (b.onclick = () => this.chat(+b.dataset.chat)));
    }
    inviteLink() {
      const base = CW.PUBLIC_URL || location.origin + location.pathname;
      return `${base}${base.includes('?') ? '&' : '?'}room=${this.room ? this.room.code : ''}`;
    }
    defaultSettings() {
      const s = this.game.settings;
      return { mode: 'clash', format: 'ffa', arena: s.arena || 'random', tod: s.timeOfDay || 'random', difficulty: s.difficulty || 'normal' };
    }
    async withServer(fn) {
      try { await this.connect(); fn(); } catch (e) { this.game.toast('📡 Can\'t reach the online server right now'); }
    }

    openOnline(joinCode) {
      const g = this.game;
      g.audio.ensure();
      g.hideAll();
      g.endMatch();
      this.stopMatch();
      g.state = 'online';
      $('online').classList.remove('hidden');
      if (!this.canConnect()) {
        this.setStatus('🔴 Online play needs the game to be opened from a web address (not a file)');
        return;
      }
      if (this.room) return this.showLobby();
      $('onAcct').classList.toggle('hidden', !!(g.account && g.account.loggedIn));
      $('onLogin').onclick = () => g.account.openLogin('Log in to earn trophies in Quick Match');
      this.setStatus(this.status === 'online' ? 'online' : this.status);
      this.connect().then(() => {
        this.send({ t: 'name', name: (this.name = this.myName()) });
        this.send({ t: 'list' });
        if (joinCode) this.send({ t: 'join', code: String(joinCode).toUpperCase().slice(0, 5) });
      }, () => {});
    }
    renderRooms(list) {
      const box = $('onRooms');
      if (!list.length) { box.innerHTML = '<div class="small">No open rooms right now. Create one and invite your friends!</div>'; return; }
      box.innerHTML = list.map((r) => {
        const mode = CW.MODES[r.mode] || {};
        return `<button class="room-row" data-code="${esc(r.code)}" ${r.state !== 'lobby' || r.players >= r.max ? 'disabled' : ''}>
          <b>${mode.icon || ''} ${esc(mode.name || r.mode)}</b><span>${esc(r.host)}'s room</span><span>👥 ${r.players}/${r.max}</span><span>${r.state === 'lobby' ? 'Join ▶' : 'In a match'}</span></button>`;
      }).join('');
      box.querySelectorAll('[data-code]').forEach((b) => (b.onclick = () => this.send({ t: 'join', code: b.dataset.code })));
    }

    showLobby() {
      const g = this.game;
      if (!this.room) return this.openOnline();
      g.hideAll();
      g.endMatch();
      this.stopMatch();
      g.state = 'lobby';
      // matchmaking rooms show the "searching" screen, rooms with friends the full room screen
      $(this.room.auto ? 'search' : 'lobby').classList.remove('hidden');
      this.renderLobby();
    }

    // ======================= PLAY: matchmaking =======================
    matchmake(mode, arena) {
      const g = this.game;
      if (this.room) { this.send({ t: 'leave' }); this.room = null; }
      this.mmArena = arena;
      this.mmMode = mode;
      // the searching screen right away (it says "Connecting…" until the server answers)
      g.hideAll();
      g.endMatch();
      g.state = 'lobby';
      $('search').classList.remove('hidden');
      this.renderSearch();
      if (!this.canConnect()) return g.playOffline(mode, arena);
      this.connect().then(() => {
        if (this.mmArena !== arena || g.state !== 'lobby') return; // cancelled while connecting
        this.send({ t: 'name', name: (this.name = this.myName()) });
        this.send({ t: 'quick', mode, arena });
      }, () => {
        if (this.mmArena !== arena || g.state !== 'lobby' || this.room) return;
        g.toast('📡 No connection: playing against bots');
        g.playOffline(mode, arena);
      });
    }
    cancelSearch() {
      this.mmArena = null;
      if (this.room) this.send({ t: 'leave' });
      this.room = null;
      this.stopMatch();
      this.game.showMenu();
    }
    renderSearch() {
      const g = this.game;
      const r = this.room;
      const a = g.arenaInfo(r ? r.settings.arena : this.mmArena || 'random');
      const modeId = r ? r.settings.mode : this.mmMode || 'clash';
      const mode = CW.MODES[modeId], fmt = CW.FORMATS[CW.MM_FORMAT[modeId]] || CW.FORMATS.ffa;
      $('srIcon').textContent = mode.icon;
      $('srArena').textContent = mode.name;
      $('srMode').textContent = `${a.icon} ${a.name} · ${fmt.label}`;
      const seats = [];
      if (r) {
        for (const p of r.players) seats.push(`<div class="sr-p ${p.id === this.id ? 'me' : ''}"><span>${p.acct ? CW.avatar(p.av) : '🧑‍✈️'}</span><b>${esc(p.name)}</b>${p.acct ? `<small>🏆 ${p.tro | 0}</small>` : ''}</div>`);
        for (const b of r.bots) seats.push(`<div class="sr-p bot"><span>🤖</span><b>${esc(b.name)}</b><small>bot</small></div>`);
      }
      const total = r ? r.seats || 8 : (CW.FORMATS[CW.MM_FORMAT[modeId]] || {}).teams ? CW.FORMATS[CW.MM_FORMAT[modeId]].teams.reduce((x, y) => x + y, 0) : 8;
      $('srPlayers').style.setProperty('--cols', Math.min(4, total));
      while (seats.length < total) seats.push('<div class="sr-p empty"><span>❔</span><small>searching…</small></div>');
      $('srPlayers').innerHTML = seats.join('');
      const list = this.mechChoices();
      $('srMech').innerHTML = list.map((e, i) => `<option value="${i}" ${e.ok ? '' : 'disabled'} ${i === this.bpIndex ? 'selected' : ''}>${esc(e.bp.name)} (${e.tag})${e.ok ? '' : ' 🔒'}</option>`).join('');
      this.renderTimer();
    }
    // leaving the online screens for the menu or Workshop also leaves the room
    leaveQuiet() {
      if (this.room) this.send({ t: 'leave' });
      this.room = null;
      this.stopMatch();
    }
    leaveRoom() {
      this.send({ t: 'leave' });
      this.room = null;
      this.stopMatch();
      this.openOnline();
    }
    // the mechs you can bring (Workshop mech, saved blueprints, examples)
    mechChoices() {
      const g = this.game;
      return [{ bp: g.currentBp, tag: 'Workshop' }].concat(g.blueprints.map((bp) => ({ bp, tag: 'Saved' }))).concat(CW.PRESETS.map((bp) => ({ bp, tag: 'Example' })))
        .map((e) => Object.assign(e, { ok: CW.validate(e.bp.parts, g.allowedDomains()).ok }));
    }
    myBp() {
      const list = this.mechChoices();
      const pick = list[this.bpIndex] && list[this.bpIndex].ok ? list[this.bpIndex] : list.find((e) => e.ok);
      return CW.cloneBp(pick ? pick.bp : CW.PRESETS[0]);
    }
    sendReady() {
      const bp = this.myBp();
      bp.color = bp.color || this.game.playerColor;
      this.send({ t: 'ready', ready: this.ready, bp });
    }
    slots(s) {
      const fmt = CW.FORMATS[s.format];
      if (!fmt) return 0;
      return COOP.includes(s.format) ? 8 : fmt.teams.length * Math.max(...fmt.teams);
    }
    // why the host can't start yet (or null when good to go)
    startProblem() {
      const r = this.room;
      if (!r) return 'Not in a room';
      const mode = CW.MODES[r.settings.mode];
      if (!mode || !mode.formats.includes(r.settings.format)) return 'Pick a match size';
      if (r.players.length > this.slots(r.settings)) return `Too many players for ${CW.FORMATS[r.settings.format].label}: pick a bigger size`;
      const waiting = r.players.filter((p) => p.id !== r.hostId && !p.ready);
      if (waiting.length && !r.auto) return `Waiting for ${waiting.map((p) => p.name).join(', ')} to get ready`;
      return null;
    }
    renderLobby() {
      const r = this.room;
      if (!r) return;
      if (r.auto) return this.renderSearch();
      const g = this.game;
      const host = r.hostId === this.id;
      const s = r.settings;
      const mode = CW.MODES[s.mode] || CW.MODES.clash;
      $('lbCode').textContent = r.code;
      this.renderTimer();
      $('lbCount').textContent = `${r.players.length + r.bots.length}/8`;
      $('lbPlayers').innerHTML = r.players.map((p) => `<div class="lb-player ${p.id === this.id ? 'me' : ''}">
          <span class="lb-ready">${p.id === r.hostId ? '👑' : p.ready ? '✅' : '⏳'}</span>
          ${p.acct ? `<span class="lb-av">${CW.avatar(p.av)}</span>` : ''}
          <b>${esc(p.name)}${p.id === this.id ? ' (you)' : ''}</b>${p.acct ? `<span class="lb-tro-s">🏆${p.tro | 0}</span>` : ''}
          <span class="small">${mode.fromScratch ? 'builds in match' : '🤖 ' + esc(p.bpName || '?')}</span>
          ${host && p.id !== this.id ? `<button class="tod-btn" data-kick="${p.id}" title="Remove from room">✖</button>` : ''}</div>`).join('') +
        r.bots.map((b) => `<div class="lb-player"><span class="lb-ready">🤖</span><b>${esc(b.name)}</b><span class="small" title="A player who joins takes this seat">bot</span>
          ${host ? `<button class="tod-btn" data-kick="${b.id}" title="Remove this bot">✖</button>` : ''}</div>`).join('') +
        `<div class="small" style="margin-top:6px">Empty slots are filled with bots.${g.account && g.account.loggedIn ? ' <button class="ws-btn" id="lbFriends">👥 Invite friends</button>' : ''}</div>`;
      if ($('lbFriends')) $('lbFriends').onclick = () => g.meta.openPanel('friends');
      $('lbPlayers').querySelectorAll('[data-kick]').forEach((b) => (b.onclick = () => this.send({ t: 'kick', id: +b.dataset.kick })));
      // match settings (host edits, everyone else sees them)
      const arenas = [['random', '🎲 Random']].concat(Object.values(CW.ARENAS).map((a) => [a.id, `${a.icon} ${a.name}`]));
      const tods = [['random', '🎲 Random'], ['day', CW.TIMES.day.label], ['sunset', CW.TIMES.sunset.label], ['night', CW.TIMES.night.label]];
      const diffs = [['easy', '🙂 Easy bots'], ['normal', '😐 Normal bots'], ['hard', '😈 Hard bots']];
      const modes = Object.entries(CW.MODES).map(([id, m]) => [id, `${m.icon} ${m.name}`]);
      const teamsOpt = [['split', '⚔ Players vs players'], ['together', '🤝 Players together vs bots']];
      const teamFmt = ['squads', 'quads'].includes(s.format);
      const fmts = mode.formats.map((id) => [id, `${CW.FORMATS[id].label} · ${CW.FORMATS[id].name}`]);
      const label = (list, v) => (list.find((o) => o[0] === v) || ['', v])[1];
      if (host) {
        const names = { mode: 'Mode', format: 'Size', teams: 'Teams', arena: 'Arena', tod: 'Time', difficulty: 'Bots' };
        const sel = (key, list) => `<label class="lb-set"><span>${names[key]}</span><select data-set="${key}">${list.map(([v, l]) => `<option value="${v}" ${(s[key] || list[0][0]) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
        $('lbSettings').innerHTML = sel('mode', modes) + sel('format', fmts) + (teamFmt ? sel('teams', teamsOpt) : '') + sel('arena', arenas) + sel('tod', tods) + sel('difficulty', diffs) + `<div class="small">${mode.desc}</div>`;
        $('lbSettings').querySelectorAll('[data-set]').forEach((el) => (el.onchange = () => {
          const ns = Object.assign({}, s, { [el.dataset.set]: el.value });
          const m2 = CW.MODES[ns.mode];
          if (!m2.formats.includes(ns.format)) ns.format = m2.formats.find((f) => this.slots({ format: f }) >= r.players.length) || m2.formats[0];
          this.send({ t: 'settings', settings: ns });
        }));
      } else {
        $('lbSettings').innerHTML = `<div class="lb-sum"><b>${label(modes, s.mode)}</b><br>${label(fmts, s.format)}${teamFmt ? ' · ' + label(teamsOpt, s.teams || 'split') : ''}<br>${label(arenas, s.arena)} · ${label(tods, s.tod)}<br>${label(diffs, s.difficulty)}</div><div class="small">${mode.desc}</div><div class="small">The host picks the mode.</div>`;
      }
      // your mech
      const list = this.mechChoices();
      $('lbMechBox').classList.toggle('hidden', !!mode.fromScratch);
      $('lbMech').innerHTML = list.map((e, i) => `<option value="${i}" ${e.ok ? '' : 'disabled'} ${i === this.bpIndex ? 'selected' : ''}>${esc(e.bp.name)} (${e.tag})${e.ok ? '' : ' 🔒'}</option>`).join('');
      const s2 = CW.analyze(this.myBp().parts);
      $('lbMechInfo').textContent = `🔩${s2.cost} · ❤${s2.hp} · 💥${Math.round(s2.dps)}/s`;
      // buttons
      $('lbReady').classList.toggle('hidden', host);
      $('lbReady').textContent = this.ready ? '✅ Ready!' : '✔ Ready up';
      $('lbReady').classList.toggle('on', this.ready);
      $('lbStart').classList.toggle('hidden', !host);
      const problem = this.startProblem();
      $('lbStart').classList.toggle('dim', !!problem);
      $('lbHint').textContent = host ? problem || 'Everyone is set. Start when you want!' : this.ready ? 'Waiting for the host to start…' : 'Pick your mech and press Ready';
      this.renderChat();
    }

    // the room's line under the invite button, with Quick Match's live countdowns
    renderTimer() {
      const r = this.room;
      if (!r || !r.auto) {
        if (r) $('lbInfo').textContent = r.pub ? '🌍 Public room' : '🔒 Private room: share the code or invite link';
        if (!r && this.game.state === 'lobby') { $('srTitle').textContent = 'Connecting…'; $('srClock').textContent = '0:00'; $('srFill').style.width = '0%'; $('srHint').textContent = ''; }
        return;
      }
      // the search clock counts up; at the end bots take the empty seats and the match starts
      const total = r.searchFor || 30;
      const gone = (performance.now() - (this.roomAt || 0)) / 1000;
      const left = Math.max(0, (r.searchIn || 0) - gone);
      const starting = !r.searchIn || r.bots.length > 0 || left <= 0;
      const t = Math.min(total, Math.floor(total - left));
      $('srClock').textContent = `0:${String(starting ? total : t).padStart(2, '0')}`;
      $('srFill').style.width = (starting ? 100 : Math.round(((total - left) / total) * 100)) + '%';
      $('srTitle').textContent = starting ? 'Match found! Starting…' : r.players.length > 1 ? `Found ${r.players.length} players…` : 'Searching for players…';
      $('srHint').textContent = starting ? '' : `Bots fill the empty seats at 0:${String(total).padStart(2, '0')}`;
    }

    // ======================= quick chat =======================
    chat(i) {
      if (!this.room || !CW.QUICK_CHAT[i]) return;
      const now = performance.now();
      if (now - this.lastChat < 900) return;
      this.lastChat = now;
      this.send({ t: 'chat', i });
      this.showChat(this.id, i);
    }
    showChat(from, i) {
      const text = CW.QUICK_CHAT[i | 0];
      if (!text || !this.room) return;
      if (from !== this.id && this.game.settings.otherChat === false) return; // Settings > Online
      const p = this.room.players.find((x) => x.id === from);
      const name = from === this.id ? 'You' : p ? p.name : '?';
      if (this.game.state === 'match') this.game.feed(`💬 ${esc(name)}: ${text}`, from === this.id ? 'good' : '');
      (this.chatLog = this.chatLog || []).push(`<b>${esc(name)}:</b> ${text}`);
      if (this.chatLog.length > 30) this.chatLog.shift();
      this.renderChat();
    }
    renderChat() {
      const box = $('lbChat');
      box.innerHTML = (this.chatLog || []).slice(-6).join('<br>') || '<span class="small">Say hi with the quick chat below</span>';
    }

    // ======================= starting a match =======================
    // host: everyone in the room plays; the host is listed first (team 0)
    humans() {
      const r = this.room;
      const list = r.players.slice().sort((a, b) => (a.id === r.hostId ? -1 : b.id === r.hostId ? 1 : 0));
      return list.map((p) => ({ id: p.id, name: p.name, bp: p.id === this.id ? this.myBp() : this.safeBp(p.bp) }));
    }
    // a blueprint from another player: keep only real parts, and fall back to an example mech if it's broken
    safeBp(bp) {
      try {
        if (!bp || !Array.isArray(bp.parts)) throw new Error('none');
        const out = { name: String(bp.name || 'Mech').slice(0, 24), color: bp.color | 0, parts: bp.parts.filter((p) => p && CW.PARTS[p.t]).slice(0, 160).map((p) => ({ t: p.t, x: p.x | 0, y: p.y | 0, z: p.z | 0 })) };
        if (!CW.validate(out.parts, 3, 9999).ok) throw new Error('invalid');
        return out;
      } catch (e) {
        return CW.cloneBp(CW.PRESETS[0]);
      }
    }
    resolveSettings() {
      const s = this.room.settings;
      const ids = Object.keys(CW.ARENAS);
      return {
        arena: CW.ARENAS[s.arena] ? s.arena : ids[Math.floor(Math.random() * ids.length)],
        tod: s.tod === 'random' || !s.tod ? ['day', 'day', 'sunset', 'night'][Math.floor(Math.random() * 4)] : s.tod,
        difficulty: s.difficulty || 'normal',
        teams: s.teams || 'split',
        botNames: (this.room.bots || []).map((b) => clean(b.name, 16)), // the lobby's bots keep their names in the match
      };
    }
    hostStart() {
      const r = this.room;
      if (!r || !this.isHost) return;
      const mode = CW.MODES[r.settings.mode];
      const res = this.resolveSettings();
      if (mode.fromScratch) {
        const payload = { kind: 'build', mode: r.settings.mode, format: r.settings.format, arena: res.arena, tod: res.tod, difficulty: res.difficulty, teams: res.teams, botNames: res.botNames, time: mode.buildTime };
        this.buildHumans = this.humans();
        this.buildBps = new Map();
        this.buildDeadline = performance.now() + (mode.buildTime + 12) * 1000;
        this.send({ t: 'begin', payload });
        this.startBuild(payload);
        clearInterval(this.buildTimer);
        this.buildTimer = setInterval(() => this.checkBuild(), 500);
        return;
      }
      this.beginMatch(r.settings.mode, r.settings.format, res, this.humans());
    }
    beginMatch(modeId, formatId, res, humans) {
      const g = this.game;
      this.building = false;
      clearInterval(this.buildTimer);
      $('netWait').classList.add('hidden');
      this.active = true;
      this.isHost = true;
      this.events = [];
      this.hits.clear();
      this.adds = [];
      g.modeId = modeId;
      g.formatId = formatId;
      g.netOpts = { arena: res.arena, tod: res.tod, difficulty: res.difficulty, teams: res.teams, botNames: res.botNames || [], seed: 1 + Math.floor(Math.random() * 1000) };
      g.startMatch(null, humans);
      const payload = {
        kind: 'match', mode: modeId, format: formatId, arena: g.world.arena.id, tod: g.timeOfDay, seed: g.netOpts.seed,
        teamMode: g.teamMode, teamCount: g.teamCount,
        roster: g.combatants.map((c) => this.rosterEntry(c)),
        obj: g.obj && g.obj.netState ? g.obj.netState() : null,
      };
      this.adds = []; // already in the roster
      this.send({ t: 'begin', payload });
    }
    rosterEntry(c) {
      const m = c.mech;
      return {
        i: c.netId, o: c.owner, h: c.human ? 1 : 0, n: c.name, col: c.color, tm: c.team, bp: c.bp, ai: c.ai.style,
        pos: [r2(m.pos.x), r2(m.pos.y), r2(m.pos.z)], yaw: r2(m.yaw), lv: c.lives, mn: c.minion ? 1 : 0,
      };
    }
    // build a combatant someone else's game created (start roster, waves, minions)
    addFromRoster(e) {
      const g = this.game;
      if (this.byId.has(e.i)) return this.byId.get(e.i);
      const bp = e.bp && Array.isArray(e.bp.parts) ? { name: clean(e.bp.name, 24), color: e.bp.color, parts: e.bp.parts } : CW.cloneBp(CW.PRESETS[0]);
      const c = g.addCombatant({ name: clean(e.n, 16) || 'Bot', isPlayer: !!e.h && e.o === this.id, human: !!e.h, color: e.col | 0, bp, ai: e.ai, team: e.tm | 0, owner: e.o, netId: e.i | 0 });
      c.mech.place(new V3(e.pos[0], 0, e.pos[2]), e.yaw);
      c.mech.protect = 3.5;
      if (e.lv !== undefined && e.lv !== null) c.lives = e.lv;
      if (e.mn) c.minion = true;
      return c;
    }
    onBegin(p) {
      if (!p || this.isHost) return;
      const g = this.game;
      if (p.kind === 'build') return this.startBuild(p);
      if (p.kind !== 'match') return;
      this.building = false;
      $('netWait').classList.add('hidden');
      if (g.workshop.active) { g.workshop.rush = null; g.workshop.close(); }
      this.active = true;
      this.isHost = false;
      this.events = [];
      this.hits.clear();
      this.adds = [];
      g.modeId = p.mode;
      g.formatId = p.format;
      g.netOpts = { arena: p.arena, tod: p.tod, seed: p.seed };
      g.beginMatchState();
      g.countdown = 3.5;
      g.teamMode = p.teamMode;
      g.teamCount = p.teamCount;
      for (const e of p.roster) this.addFromRoster(e);
      g.player = g.combatants.find((c) => c.isPlayer) || g.combatants[0];
      const mode = CW.MODES[p.mode], fmt = CW.FORMATS[p.format];
      g.survival = mode.survival ? { wave: 0, breakT: 4, cleared: 0 } : null;
      if (mode.objective) {
        g.obj = new CW.OBJECTIVES[mode.objective](g, mode);
        g.obj.start();
        if (p.obj) g.obj.netApply(p.obj, true);
        if (mode.objective === 'boss') g.teamCount = 2;
        g.feed(`${mode.icon} ${mode.name}: ${mode.desc}`);
      } else if (g.survival) {
        g.teamCount = 2;
        g.feed('🛡 Survival: hold out against endless waves together!');
      } else g.feed(`🌐 ${mode.name} · ${fmt.name} ${fmt.label}: ${g.combatants.length} mechs`);
      if (g.teamMode && !g.survival && mode.objective !== 'boss') g.feed(`You are on team ${CW.TEAMS[g.player.team].name}. No friendly fire.`);
      g.afterSpawn();
    }

    // ---------------- Rush Build online: everyone builds, then the host starts the match ----------------
    startBuild(p) {
      const g = this.game;
      const mode = CW.MODES[p.mode], fmt = CW.FORMATS[p.format];
      this.building = true;
      this.buildInfo = p;
      g.modeId = p.mode;
      g.formatId = p.format;
      g.hideAll();
      g.endMatch();
      g.state = 'workshop';
      const scratch = { name: 'Scrap Rush Mech', color: g.currentBp.color || g.playerColor, parts: [{ t: 'core', x: 0, y: 0, z: 0 }] };
      g.workshop.open(scratch, {
        time: p.time,
        budget: mode.budget,
        fromScratch: true,
        modeName: `🌐 ${mode.name} · ${fmt.name} ${fmt.label}`,
        onReady: (bp) => this.submitBuild(bp),
        onBack: () => { this.building = false; this.leaveRoom(); },
      });
    }
    submitBuild(bp) {
      const g = this.game;
      g.hideAll();
      g.state = 'lobby';
      $('netWait').classList.remove('hidden');
      $('netWaitText').textContent = 'Mech ready! Waiting for the other builders…';
      if (this.isHost) { this.buildBps.set(this.id, bp); this.checkBuild(); }
      else this.send({ t: 'st', toHost: true, e: [{ k: 'bp', bp }] });
    }
    checkBuild() {
      if (!this.building || !this.isHost || !this.room) return clearInterval(this.buildTimer);
      const humans = this.buildHumans.filter((h) => this.room.players.some((p) => p.id === h.id));
      const all = humans.every((h) => this.buildBps.has(h.id));
      if (!all && performance.now() < this.buildDeadline) return;
      for (const h of humans) h.bp = this.buildBps.has(h.id) ? (h.id === this.id ? this.buildBps.get(h.id) : this.safeBp(this.buildBps.get(h.id))) : CW.cloneBp(CW.PRESETS[0]);
      if (this.game.workshop.active) { this.game.workshop.rush = null; this.game.workshop.close(); }
      const p = this.buildInfo;
      this.beginMatch(p.mode, p.format, { arena: p.arena, tod: p.tod, difficulty: p.difficulty, teams: p.teams, botNames: p.botNames }, humans);
    }

    // ======================= during the match =======================
    stopMatch() {
      this.active = false;
      this.building = false;
      clearInterval(this.buildTimer);
      this.events = [];
      this.hits.clear();
      this.adds = [];
      const w = $('netWait');
      if (w) w.classList.add('hidden');
    }

    // called every frame of an online match: send our state (and queued events) 20×/s
    update(dt) {
      if (!this.active) return;
      this.sendT -= dt;
      if (this.sendT > 0) return;
      this.sendT += 1 / SEND_HZ;
      if (this.sendT < 0) this.sendT = 0;
      this.flush();
    }
    flush() {
      const g = this.game;
      const s = [];
      for (const c of g.combatants) if (c.owner === this.id && c.alive) s.push(this.snap(c));
      if (this.isHost && g.obj && g.obj.netState) {
        this.objT -= 1 / SEND_HZ;
        if (this.objT <= 0) { this.objT = 0.2; this.events.push({ k: 'obj', s: g.obj.netState() }); }
      }
      for (const h of this.hits.values()) { h.d = Math.round(h.d * 100) / 100; this.events.push(h); }
      this.hits.clear();
      const ev = this.adds.map((c) => ({ k: 'add', r: this.rosterEntry(c) })).concat(this.events);
      this.adds = [];
      this.events = [];
      const msg = { t: 'st', s };
      if (ev.length) msg.e = ev;
      this.send(msg);
    }
    snap(c) {
      const m = c.mech, p = c.pilot;
      const o = { i: c.netId, l: c.life };
      if (m && m.alive) {
        const a = m.input.aim;
        const f = (m.input.fire && a ? 1 : 0) | (m.occupied ? 2 : 0) | (m.dashTime > 0 ? 4 : 0) | (m.protect > 0 ? 8 : 0) | (m.overcharge > 0 ? 16 : 0) | (m.turbo > 0 ? 32 : 0) | (m.input.throttle > 0 ? 64 : 0);
        o.m = [r2(m.pos.x), r2(m.pos.y), r2(m.pos.z), r2(m.vel.x), r2(m.vel.y), r2(m.vel.z), r2(m.yaw), r2(m.pitch), r2(m.roll), a ? r2(a.x) : 0, a ? r2(a.y) : 0, a ? r2(a.z) : 0, f, Math.round(m.shield)];
        const hp = m.parts.map((q) => (q.alive ? Math.ceil(q.hp) : -1));
        const key = hp.join(',');
        if (key !== m.netHpKey || this.game.time - (m.netHpT || 0) > 1) { o.h = hp; m.netHpKey = key; m.netHpT = this.game.time; }
      }
      if (p && p.alive) {
        const inp = p.inp || {};
        const a = inp.aim;
        o.p = [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r2(p.vel.x), r2(p.vel.y), r2(p.vel.z), r2(p.yaw), a ? r2(a.x) : 0, a ? r2(a.y) : 0, a ? r2(a.z) : 0, inp.fire && a ? 1 : 0, Math.ceil(p.hp)];
      }
      return o;
    }

    onState(m) {
      const g = this.game;
      if (!this.active && !(this.isHost && this.building)) return;
      if (m.e) for (const e of m.e) { try { this.onEvent(e, m.from); } catch (err) { console.error('net event', e && e.k, err); } }
      if (!this.active || g.state !== 'match' || !m.s) return;
      for (const s of m.s) {
        const c = this.byId.get(s.i);
        if (c && c.owner === m.from) this.applySnap(c, s);
      }
    }
    applySnap(c, s) {
      const g = this.game;
      const now = performance.now();
      const m = c.mech;
      if (s.m && m && m.alive && m.remote && s.l === c.life) {
        const a = s.m;
        const n = m.net || (m.net = { pos: new V3(), vel: new V3(), err: new V3(), yaw: 0, pitch: 0, roll: 0, t: 0 });
        if (!n.t) { m.pos.set(a[0], a[1], a[2]); m.yaw = a[6]; } // first update: jump straight there
        n.pos.set(a[0], a[1], a[2]);
        n.vel.set(a[3], a[4], a[5]);
        n.yaw = a[6]; n.pitch = a[7]; n.roll = a[8];
        n.t = now;
        n.fresh = true;
        const f = a[12];
        m.netAim = m.netAim || new V3();
        m.input.aim = m.netAim.set(a[9], a[10], a[11]);
        m.input.fire = !!(f & 1);
        m.input.throttle = f & 64 ? 1 : 0;
        m.occupied = !!(f & 2);
        if (f & 4) m.dashTime = Math.max(m.dashTime, 0.1);
        m.protect = f & 8 ? 0.3 : 0;
        m.overcharge = f & 16 ? 0.3 : 0;
        m.turbo = f & 32 ? 0.3 : 0;
        m.shield = a[13];
        if (s.h) this.applyHp(m, s.h);
      }
      if (s.p && c.alive) {
        const a = s.p;
        if (!c.pilot || !c.pilot.alive) {
          if (c.pilot) return; // dead pilot: the 'elim' event handles it
          c.pilot = new CW.Pilot(g, c, new V3(a[0], a[1], a[2]), a[11]);
          g.pilots.push(c.pilot);
        }
        const pl = c.pilot;
        const n = pl.net || (pl.net = { pos: new V3(), vel: new V3(), err: new V3(), yaw: 0, t: 0, aim: new V3(), fire: false });
        n.pos.set(a[0], a[1], a[2]);
        n.vel.set(a[3], a[4], a[5]);
        n.yaw = a[6];
        n.aim.set(a[7], a[8], a[9]);
        n.fire = !!a[10];
        n.t = now;
        n.fresh = true;
        pl.hp = a[11];
      } else if (!s.p && c.pilot && c.pilot.alive && c.pilot.remote) {
        // they climbed back into their mech
        c.pilotHp = c.pilot.hp;
        c.pilot.dispose();
        g.pilots = g.pilots.filter((x) => x !== c.pilot);
        c.pilot = null;
      }
    }
    // part health from the mech's owner: break or rebuild parts so every game shows the same mech
    applyHp(m, hp) {
      if (hp.length !== m.parts.length) return;
      this.applying = true;
      try {
        for (let i = 0; i < hp.length && m.alive; i++) {
          const p = m.parts[i], v = hp[i];
          if (v < 0) { if (p.alive && p !== m.core) m.breakPart(p, null); }
          else { if (!p.alive) m.rebuildPart(p, true); p.hp = v; }
        }
      } finally { this.applying = false; }
    }

    // ---------------- hits on things another game owns ----------------
    hitMech(mech, part, dmg, who) {
      const c = mech.combatant;
      const pt = mech.parts.indexOf(part);
      const by = who ? who.netId : -1;
      const key = c.netId + ':' + pt + ':' + by;
      const h = this.hits.get(key);
      if (h) h.d += dmg;
      else this.hits.set(key, { k: 'hit', c: c.netId, pt, d: dmg, by, l: c.life });
      if (mech.protect > 0 || mech.shield > 0) mech.shieldFlash = 1;
    }
    hitPilot(pilot, dmg, who) {
      const c = pilot.combatant;
      const by = who ? who.netId : -1;
      const key = 'p' + c.netId + ':' + by;
      const h = this.hits.get(key);
      if (h) h.d += dmg;
      else this.hits.set(key, { k: 'phit', c: c.netId, d: dmg, by });
    }
    // our game decided something about a combatant we own: tell the others
    mechDestroyed(mech, who) {
      const c = mech.combatant;
      if (this.active && this.owns(c)) this.events.push({ k: 'wreck', c: c.netId, by: who ? who.netId : -1, l: c.life });
    }
    pilotKilled(pilot, who) {
      const c = pilot.combatant;
      if (this.active && this.owns(c)) this.events.push({ k: 'elim', c: c.netId, by: who ? who.netId : -1 });
    }
    spawned(c) {
      if (this.active && this.owns(c)) this.events.push({ k: 'spawn', c: c.netId, x: r2(c.mech.pos.x), z: r2(c.mech.pos.z), yaw: r2(c.mech.yaw), l: c.life });
    }
    added(c) { if (this.active && this.isHost && this.game.state === 'match') this.adds.push(c); }
    event(e) { if (this.active && this.isHost) this.events.push(e); }

    onEvent(e, from) {
      const g = this.game;
      const C = (id) => (id === undefined || id < 0 ? null : this.byId.get(id) || null);
      if (e.k === 'bp') {
        if (this.isHost && this.building && this.buildBps) { this.buildBps.set(from, e.bp); this.checkBuild(); }
        return;
      }
      if (!this.active || g.state !== 'match') return;
      const hostMsg = this.room && from === this.room.hostId;
      switch (e.k) {
        case 'hit': {
          const c = C(e.c);
          if (!c || !this.owns(c) || !c.mech || !c.mech.alive || e.l !== c.life) return;
          const part = c.mech.parts[e.pt];
          if (!part) return;
          this.applying = true;
          try { c.mech.hit(part, Math.min(500, +e.d || 0), C(e.by)); } finally { this.applying = false; }
          break;
        }
        case 'phit': {
          const c = C(e.c);
          if (!c || !this.owns(c) || !c.pilot || !c.pilot.alive) return;
          this.applying = true;
          try { c.pilot.hit(Math.min(500, +e.d || 0), C(e.by)); } finally { this.applying = false; }
          break;
        }
        case 'wreck': {
          const c = C(e.c);
          if (!c || this.owns(c) || !c.mech || !c.mech.alive || e.l !== c.life) return;
          this.applying = true;
          try { c.mech.destroy(C(e.by)); } finally { this.applying = false; }
          break;
        }
        case 'elim': {
          const c = C(e.c);
          if (!c || this.owns(c) || !c.alive) return;
          this.applying = true;
          try {
            if (c.pilot && c.pilot.alive) c.pilot.die(C(e.by));
            else g.onPilotKilled({ combatant: c }, C(e.by));
          } finally { this.applying = false; }
          break;
        }
        case 'spawn': {
          const c = C(e.c);
          if (!c || this.owns(c)) return;
          g.respawnMech(c, new V3(e.x, 0, e.z), e.yaw);
          c.life = e.l;
          break;
        }
        // ---- from the host only ----
        case 'add': if (hostMsg) { this.addFromRoster(e.r); g.buildTags(); } break;
        case 'pk': if (hostMsg) g.pickups.netCollect(e.i, C(e.c)); break;
        case 'chest': if (hostMsg) g.chests.netSpawn(e); break;
        case 'open': if (hostMsg) g.chests.netOpen(e.id, C(e.c), e.kinds || []); break;
        case 'obj': if (hostMsg && g.obj && g.obj.netApply) g.obj.netApply(e.s); break;
        case 'wave': if (hostMsg) g.netWave(e); break;
        case 'end': if (hostMsg) g.netEnd(e); break;
        case 'super': g.supers.onRemote(e); break;
      }
    }

    // a player left mid-match: their mech keeps fighting as a bot (run by the host)
    onLeft(id) {
      const g = this.game;
      if (this.building && this.isHost) { this.checkBuild(); return; }
      if (!this.active) return;
      const host = this.room ? this.room.hostId : 0;
      for (const c of g.combatants) {
        if (c.owner !== id) continue;
        if (c.human) g.feed(`📡 ${esc(c.name)} left the match. A bot takes over.`);
        c.owner = host;
        c.human = false;
        if (host === this.id) {
          if (c.mech) { c.mech.remote = false; c.mech.net = null; }
          if (c.pilot) { c.pilot.remote = false; c.pilot.net = null; }
          const d = c.mech ? c.mech.domains : new Set();
          c.ai.style = d.has('air') ? 'heli' : d.has('water') && !d.has('land') ? 'boat' : 'ground';
        }
      }
    }
    // the host's game: tell everyone the match is over
    matchEnded(winner, places) {
      if (!this.active || !this.isHost) return;
      const g = this.game;
      this.events.push({ k: 'end', w: winner, pl: places, t: g.endTimer });
      this.flush();
      // each player's placing for the server (Quick Match trophies): { clientId: place } out of n places
      const res = {};
      for (const c of g.combatants) if (c.human && places && places[c.netId]) res[c.owner] = places[c.netId];
      const n = g.modeId === 'race' ? g.combatants.length : g.teamMode ? g.teamCount : g.combatants.filter((c) => !c.minion).length;
      this.send({ t: 'end', res, n });
    }
    hud() {
      if (!this.active) return '';
      return `🌐 ${this.isHost ? 'Host' : 'Online'} · ${this.ping} ms · 1-8 chat`;
    }
  }

  CW.Net = Net;
})();
