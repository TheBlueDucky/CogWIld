// Cogwild — voice chat: talk with your party, and (if you choose) everyone in your match.
//
// The games call each other directly (WebRTC, audio only); the server (server/talk.js) only says who to call
// and passes the call set-up along. Needs an account; off with "Quick chat only" and on game portals.
// Settings > Voice: on/off, who you hear, open mic or push-to-talk, the keys (push-to-talk B, mute M),
// microphone, speakers/headphones and volume. The first time (and after an update or on a new account)
// the game asks whether you want it.
(function () {
  const CW = window.CW;
  const $ = (id) => document.getElementById(id);
  const esc = CW.esc;

  class Voice {
    constructor(game) {
      this.game = game;
      this.peers = new Map(); // client id -> { pc, name, audio, level, talking, queue }
      this.stream = null;
      this.muted = false;
      this.ptt = false; // push-to-talk key held
      this.ice = null;
      this.bindUi();
      setInterval(() => this.tick(), 120);
    }
    get s() { return this.game.settings; }
    get net() { return this.game.net; }
    get acct() { return this.game.account; }
    get supported() { return !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
    // should voice be running right now?
    get wanted() { return !!this.s.voice && this.supported && !CW.PORTAL && !!this.acct.loggedIn && this.game.talk.mode !== 'quick'; }
    get live() { return !!this.stream; }
    get talkMode() { return this.s.vcMode === 'ptt' ? 'ptt' : 'open'; }

    bindUi() {
      // the 🎤 buttons: tap to mute/unmute (open mic) or hold to talk (push-to-talk); voice off: open its settings
      for (const id of ['btnVoice', 'hudVoice']) {
        const b = $(id);
        b.addEventListener('pointerdown', (e) => { if (this.live && this.talkMode === 'ptt') { e.preventDefault(); this.ptt = true; this.applyMic(); } });
        const up = () => { if (this.ptt && this.talkMode === 'ptt') { this.ptt = false; this.applyMic(); } };
        b.addEventListener('pointerup', up);
        b.addEventListener('pointerleave', up);
        b.addEventListener('click', () => {
          if (!this.s.voice || !this.live) return this.openSettings();
          if (this.talkMode === 'open') this.toggleMute();
        });
      }
      // keys: push-to-talk (hold) and mute (press); never while typing
      const typing = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
      window.addEventListener('keydown', (e) => {
        if (!this.live || typing(e) || this.game.listening) return;
        if (e.code === (this.s.vcPtt || 'KeyB') && this.talkMode === 'ptt' && !this.ptt) { this.ptt = true; this.applyMic(); }
        if (e.code === (this.s.vcMute || 'KeyM') && !e.repeat && this.game.state !== 'workshop') this.toggleMute();
      });
      window.addEventListener('keyup', (e) => { if (e.code === (this.s.vcPtt || 'KeyB') && this.ptt) { this.ptt = false; this.applyMic(); } });
      window.addEventListener('blur', () => { if (this.ptt) { this.ptt = false; this.applyMic(); } });
      // the first-time question
      $('vcYes').onclick = () => { this.answer(true); };
      $('vcNo').onclick = () => { this.answer(false); };
      $('vcHow').onclick = () => { this.answer(true, true); };
    }
    openSettings() {
      this.game.meta.setTab = 'voice';
      this.game.meta.openPanel('settings');
    }
    toggleMute() {
      this.muted = !this.muted;
      this.applyMic();
      this.game.toast(this.muted ? '🔇 Microphone muted' : '🎤 Microphone on');
    }

    // ======================= asking first =======================
    // the first time, after an update and on a new account (not on portals, not for "Quick chat only")
    maybeAsk() {
      if (CW.PORTAL || !this.supported || this.game.talk.mode === 'quick' || this.game.state !== 'menu') return;
      const stamp = `${CW.VERSION}|${this.acct.me ? this.acct.me.name.toLowerCase() : 'guest'}`;
      if (this.s.vcAsked === stamp) return;
      // still logging in (or the game wants a login first): ask once we know who's playing
      if ((this.acct.session && !this.acct.me) || this.acct.loginRequired()) return;
      // not on top of the login box, a menu or the first-time welcome
      if (!$('acct').classList.contains('hidden') || !$('panel').classList.contains('hidden') || !$('confirm').classList.contains('hidden') || document.querySelector('#menu .first-run:not(.hidden)')) {
        clearTimeout(this.askT);
        this.askT = setTimeout(() => this.maybeAsk(), 3000);
        return;
      }
      this.askStamp = stamp;
      const pc = !this.game.touch.on;
      $('vcAskKeys').innerHTML = pc
        ? `Your mic is on while you're in voice. Press <b>${CW.keyName(this.s.vcMute || 'KeyM')}</b> to mute, or switch to push-to-talk (hold <b>${CW.keyName(this.s.vcPtt || 'KeyB')}</b>) in Settings › 🎤 Voice.`
        : 'Tap 🎤 to mute or unmute. Change who you hear, push-to-talk, your mic and speaker in Settings › 🎤 Voice.';
      $('vcAsk').classList.remove('hidden');
    }
    answer(on, show) {
      $('vcAsk').classList.add('hidden');
      this.s.vcAsked = this.askStamp;
      this.s.voice = on;
      this.game.saveProfile();
      this.apply();
      if (on && !this.acct.loggedIn) this.game.toast('🎤 Voice chat starts once you log in');
      if (show) this.openSettings();
    }
    closeAsk() { if (!$('vcAsk').classList.contains('hidden')) { this.answer(false); return true; } return false; }

    // ======================= on / off =======================
    // call after anything that may turn voice on or off (settings, log in/out, chat mode)
    async apply() {
      if (this.wanted && !this.stream && !this.starting) {
        this.starting = true;
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({ audio: this.constraints() });
          this.watchLevel(this.stream, (v) => { this.myLevel = v; });
          this.applyMic();
          this.net.send({ t: 'vcState', on: true, hear: this.s.vcHear === 'party' ? 'party' : 'game' });
        } catch (e) {
          this.stream = null;
          this.game.toast(e && e.name === 'NotAllowedError' ? '🎤 The game may not use your microphone. Allow it to use voice chat.' : '🎤 No microphone found');
        }
        this.starting = false;
        if (!this.wanted) this.stop();
      } else if (!this.wanted && this.stream) this.stop();
      else if (this.stream) this.net.send({ t: 'vcState', on: true, hear: this.s.vcHear === 'party' ? 'party' : 'game' });
      this.render();
    }
    stop() {
      for (const id of [...this.peers.keys()]) this.drop(id);
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.ptt = false;
      if (this.net.status === 'online') this.net.send({ t: 'vcState', on: false });
      this.render();
    }
    // the server lost us (reconnecting): calls end, voice comes back once logged in again
    onDisconnect() { for (const id of [...this.peers.keys()]) this.drop(id); }
    constraints() {
      const a = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      if (this.s.vcMic) a.deviceId = { exact: this.s.vcMic };
      return a;
    }
    // a new microphone was picked
    async changeMic() {
      if (!this.stream) return this.apply();
      try {
        const next = await navigator.mediaDevices.getUserMedia({ audio: this.constraints() });
        const track = next.getAudioTracks()[0];
        for (const p of this.peers.values()) for (const snd of p.pc.getSenders()) if (snd.track && snd.track.kind === 'audio') snd.replaceTrack(track);
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = next;
        this.watchLevel(next, (v) => { this.myLevel = v; });
        this.applyMic();
      } catch (e) { this.game.toast('🎤 That microphone could not be used'); }
    }
    changeOutput() { for (const p of this.peers.values()) this.sink(p.audio); }
    sink(audio) { if (audio && audio.setSinkId && this.s.vcOut) audio.setSinkId(this.s.vcOut).catch(() => {}); }
    changeVolume() { for (const p of this.peers.values()) if (p.audio) p.audio.volume = this.vol(); }
    vol() { return Math.max(0, Math.min(1, this.s.vcVol == null ? 1 : this.s.vcVol)); }
    // the mic sends sound only when not muted and (open mic, or push-to-talk held)
    applyMic() {
      const on = !this.muted && (this.talkMode === 'open' || this.ptt);
      if (this.stream) this.stream.getAudioTracks().forEach((t) => (t.enabled = on));
      this.render();
    }
    get sending() { return !!this.stream && !this.muted && (this.talkMode === 'open' || this.ptt); }
    async devices() {
      try { return await navigator.mediaDevices.enumerateDevices(); } catch (e) { return []; }
    }

    // ======================= calls =======================
    onMessage(m) {
      if (m.t === 'vcPeers') { this.ice = m.ice || this.ice; this.relay = !!m.relay; this.sync(m.list || []); return true; }
      if (m.t === 'vcSig') { this.signal(m.from, m.d); return true; }
      return false;
    }
    sync(list) {
      if (!this.stream) return;
      const ids = new Set(list.map((p) => p.id));
      for (const id of [...this.peers.keys()]) if (!ids.has(id)) this.drop(id);
      for (const p of list) {
        if (this.peers.has(p.id)) { this.peers.get(p.id).name = p.name; continue; }
        this.call(p.id, p.name, this.net.id < p.id); // the lower id starts the call
      }
      this.render();
    }
    call(id, name, start) {
      // through the server's relay when it has one: other players never learn your internet address
      const pc = new RTCPeerConnection({ iceServers: this.ice || [{ urls: 'stun:stun.l.google.com:19302' }], iceTransportPolicy: this.relay ? 'relay' : 'all' });
      const peer = { pc, name, audio: null, level: 0, talking: false, queue: [] };
      this.peers.set(id, peer);
      for (const t of this.stream.getAudioTracks()) pc.addTrack(t, this.stream);
      pc.onicecandidate = (e) => { if (e.candidate) this.net.send({ t: 'vcSig', to: id, d: { ice: e.candidate.toJSON() } }); };
      pc.ontrack = (e) => {
        const audio = new Audio();
        audio.autoplay = true;
        audio.srcObject = e.streams[0] || new MediaStream([e.track]);
        audio.volume = this.vol();
        this.sink(audio);
        audio.play().catch(() => {});
        peer.audio = audio;
        this.watchLevel(audio.srcObject, (v) => { peer.level = v; });
      };
      pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') { this.drop(id); this.render(); } };
      if (start) {
        pc.onnegotiationneeded = async () => {
          try {
            await pc.setLocalDescription(await pc.createOffer());
            this.net.send({ t: 'vcSig', to: id, d: { sdp: pc.localDescription.toJSON() } });
          } catch (e) { /* the next peer list tries again */ }
        };
      }
    }
    async signal(from, d) {
      const peer = this.peers.get(from);
      if (!peer || !d) return;
      const pc = peer.pc;
      try {
        if (d.sdp) {
          await pc.setRemoteDescription(d.sdp);
          for (const c of peer.queue.splice(0)) await pc.addIceCandidate(c).catch(() => {});
          if (d.sdp.type === 'offer') {
            await pc.setLocalDescription(await pc.createAnswer());
            this.net.send({ t: 'vcSig', to: from, d: { sdp: pc.localDescription.toJSON() } });
          }
        } else if (d.ice) {
          if (pc.remoteDescription) await pc.addIceCandidate(d.ice).catch(() => {});
          else peer.queue.push(d.ice);
        }
      } catch (e) { /* a broken call is dropped by the next peer list */ }
    }
    drop(id) {
      const p = this.peers.get(id);
      if (!p) return;
      try { p.pc.close(); } catch (e) { /* closed */ }
      if (p.audio) { p.audio.pause(); p.audio.srcObject = null; }
      if (p.stopLevel) p.stopLevel();
      this.peers.delete(id);
    }

    // ======================= who's talking =======================
    watchLevel(stream, set) {
      try {
        this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        const src = this.ctx.createMediaStreamSource(stream);
        const an = this.ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        const buf = new Uint8Array(an.fftSize);
        stream._level = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); return m / 128; };
        set(0);
        stream._set = set;
      } catch (e) { /* no meter */ }
    }
    level(stream) { return stream && stream._level ? stream._level() : 0; }
    tick() {
      if (!this.stream) return;
      this.myLevel = this.sending ? this.level(this.stream) : 0;
      let changed = false;
      for (const p of this.peers.values()) {
        const v = p.audio ? this.level(p.audio.srcObject) : 0;
        const talking = v > 0.06;
        if (talking !== p.talking) { p.talking = talking; changed = true; }
      }
      const me = this.myLevel > 0.06;
      if (me !== this.meTalking) { this.meTalking = me; changed = true; }
      if (changed) this.render();
      const meter = $('vcMeter');
      if (meter) meter.style.width = Math.min(100, Math.round(this.myLevel * 250)) + '%';
    }
    // the 🎤 buttons and the list of who's talking
    render() {
      const on = !!this.s.voice;
      const state = !on ? 'off' : !this.live ? 'wait' : this.muted ? 'muted' : this.sending ? 'live' : 'ptt';
      const icon = state === 'muted' ? '🔇' : '🎤';
      for (const id of ['btnVoice', 'hudVoice']) {
        const b = $(id);
        if (!b) continue;
        b.firstChild.textContent = icon;
        b.dataset.vc = state;
        b.classList.toggle('talking', !!this.meTalking && state === 'live');
        b.classList.toggle('hidden', CW.PORTAL || !this.supported || this.game.talk.mode === 'quick');
      }
      const talking = [...this.peers.values()].filter((p) => p.talking);
      $('vcTalk').innerHTML = talking.map((p) => `<span>🔊 ${esc(p.name)}</span>`).join('');
      $('vcTalk').classList.toggle('hidden', !talking.length);
      $('vcTalk').classList.toggle('in-match', this.game.state === 'match');
      const n = $('vcCount');
      if (n) n.textContent = this.live ? (this.peers.size ? `${this.peers.size} in voice` : 'nobody else yet') : '';
    }
  }

  CW.Voice = Voice;
})();
