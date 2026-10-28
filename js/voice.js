// Cogwild — voice chat: talk with your party, and (if you choose) everyone in your match.
//
// The games call each other through the server's relay (WebRTC, audio only); the server (server/talk.js) only says
// who to call and passes the call set-up along. Needs an account; off with "Quick chat only" and on game portals.
// You're in voice only while there's someone to talk to: in a party, or in a room/match when you chose to hear your
// match. The microphone is only opened then, and only while you're not muted or deafened (it's released otherwise).
// Settings > Voice: on/off, who you hear, open mic or push-to-talk, the keys (push-to-talk B, mute M, deafen N; any can
// be turned off), microphone, speakers/headphones and volume. The first time (and after an update or on a new account)
// the game asks whether you want it.
// Voices play through the game's sound: in the lobby straight ahead; in a match from the side that player is on (left or
// right), always at full volume however far away they are (v1.9.7: as clear as in the lobby). While someone talks in a
// match the game's own sounds get a little quieter. A call (js/calls.js) is someone to talk to as well.
(function () {
  const CW = window.CW;
  const $ = (id) => document.getElementById(id);
  const esc = CW.esc;
  // default keys; 'none' = no key
  CW.VOICE_KEYS = { vcPtt: 'KeyB', vcMute: 'KeyM', vcDeaf: 'KeyN' };

  class Voice {
    constructor(game) {
      this.game = game;
      this.peers = new Map(); // client id -> { pc, tx, name, audio, talking, queue }
      this.stream = null; // the microphone (only while needed)
      this.joined = false; // told the server we're in voice
      this.ptt = false; // push-to-talk key held
      this.ice = null;
      this.bindUi();
      setInterval(() => this.tick(), 120);
      setInterval(() => { if (this.shouldJoin !== this.joined) this.apply(); }, 1000); // a party or match started/ended
      setInterval(() => this.place(), 50);
      // browsers start sound only after a click or key: wake the voice sound up then
      const wake = () => { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); };
      window.addEventListener('pointerdown', wake, true);
      window.addEventListener('keydown', wake, true);
    }
    // one sound engine for voices and the level meters
    audioCtx() {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.s.vcOut && this.ctx.setSinkId) this.ctx.setSinkId(this.s.vcOut).catch(() => {});
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    get s() { return this.game.settings; }
    get net() { return this.game.net; }
    get acct() { return this.game.account; }
    get supported() { return !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
    // voice is on in Settings and may be used here
    get wanted() { return !!this.s.voice && this.supported && !CW.PORTAL && !!this.acct.loggedIn && this.game.talk.mode !== 'quick'; }
    // ...and there's someone to talk to: your party, or your room/match when you hear your match
    get inContext() { return !!this.acct.party || (this.game.calls && this.game.calls.live) || (this.s.vcHear !== 'party' && !!this.net.room); }
    get shouldJoin() { return this.wanted && this.inContext && this.net.status === 'online'; }
    get muted() { return !!this.s.vcMuted; }
    get deaf() { return !!this.s.vcDeafened; }
    get talkMode() { return this.s.vcMode === 'ptt' ? 'ptt' : 'open'; }
    key(id) { const k = this.s[id]; return k === undefined || k === '' ? CW.VOICE_KEYS[id] : k; }
    get sending() { return !!this.stream && !this.muted && !this.deaf && (this.talkMode === 'open' || this.ptt); }

    bindUi() {
      // 🎤: tap to mute/unmute (or hold to talk with push-to-talk); 🎧: tap to deafen. Voice off: opens its settings
      for (const id of ['btnVoice', 'hudVoice']) {
        const b = $(id);
        b.addEventListener('pointerdown', (e) => { if (this.joined && this.talkMode === 'ptt' && !this.muted && !this.deaf) { e.preventDefault(); this.ptt = true; this.applyMic(); } });
        const up = () => { if (this.ptt) { this.ptt = false; this.applyMic(); } };
        b.addEventListener('pointerup', up);
        b.addEventListener('pointerleave', up);
        b.addEventListener('click', () => {
          if (!this.s.voice) return this.openSettings();
          if (this.talkMode === 'open' || this.muted || this.deaf) this.toggleMute();
        });
      }
      for (const id of ['btnDeaf', 'hudDeaf']) $(id).addEventListener('click', () => (this.s.voice ? this.toggleDeaf() : this.openSettings()));
      // keys: push-to-talk (hold), mute and deafen (press); never while typing
      const typing = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
      window.addEventListener('keydown', (e) => {
        if (!this.s.voice || !this.wanted || typing(e) || e.repeat) return;
        if (this.game.state === 'workshop') return; // the Workshop has its own keys (M = mirror)
        const hit = (id) => { const ok = CW.keyHit(e, this.key(id)); if (ok && this.key(id).includes('+')) e.preventDefault(); return ok; }; // Shift + Tab must not move the focus
        if (hit('vcPtt') && this.talkMode === 'ptt' && !this.ptt) { this.ptt = true; this.applyMic(); }
        if (hit('vcMute')) this.toggleMute();
        if (hit('vcDeaf')) this.toggleDeaf();
      });
      window.addEventListener('keyup', (e) => { if (this.ptt && CW.keyPart(e.code, this.key('vcPtt'))) { this.ptt = false; this.applyMic(); } });
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
    // mute: the microphone is let go (no app is listening); unmuting also undeafens
    toggleMute() {
      const muteNow = !(this.muted || this.deaf);
      this.s.vcMuted = muteNow;
      if (!muteNow) this.s.vcDeafened = false;
      this.game.saveProfile();
      this.apply();
      this.game.toast(muteNow ? '🔇 Microphone muted' : '🎤 Microphone on');
    }
    // deafen: you hear nobody (and your microphone is off too, like most voice apps)
    toggleDeaf() {
      this.s.vcDeafened = !this.deaf;
      this.game.saveProfile();
      this.apply();
      this.game.toast(this.deaf ? '🔕 Deafened: you hear nobody' : '🎧 You hear voice chat again');
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
      if (!$('acct').classList.contains('hidden') || !$('panel').classList.contains('hidden') || !$('confirm').classList.contains('hidden') || this.game.talk.isOpen || document.querySelector('#menu .first-run:not(.hidden)')) {
        clearTimeout(this.askT);
        this.askT = setTimeout(() => this.maybeAsk(), 3000);
        return;
      }
      this.askStamp = stamp;
      const pc = !this.game.touch.on, k = (id) => (this.key(id) === 'none' ? null : CW.bindName(this.key(id)));
      $('vcAskKeys').innerHTML = pc
        ? `Your mic is only used while you're in a party or a match. ${k('vcMute') ? `Press <b>${k('vcMute')}</b> to mute` : 'Click 🎤 to mute'}${k('vcDeaf') ? `, <b>${k('vcDeaf')}</b> to stop hearing others` : ''}, or switch to push-to-talk${k('vcPtt') ? ` (hold <b>${k('vcPtt')}</b>)` : ''} in Settings › 🎤 Voice chat.`
        : "Your mic is only used while you're in a party or a match. Tap 🎤 to mute, 🎧 to stop hearing others. More in Settings › 🎤 Voice chat.";
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
    // call after anything that may change voice (settings, log in/out, chat mode, party, room, mute, deafen)
    async apply() {
      const join = this.shouldJoin;
      if (join !== this.joined) {
        this.joined = join;
        this.net.send({ t: 'vcState', on: join, hear: this.s.vcHear === 'party' ? 'party' : 'game' });
        // the Android app: voice out of the loudspeaker (or headphones), not the quiet earpiece
        try { if (window.CogwildNative && window.CogwildNative.setVoiceAudio) window.CogwildNative.setVoiceAudio(join); } catch (e) { /* not the app */ }
        if (!join) for (const id of [...this.peers.keys()]) this.drop(id);
      } else if (join && this.hearSent !== this.s.vcHear) this.net.send({ t: 'vcState', on: true, hear: this.s.vcHear === 'party' ? 'party' : 'game' });
      this.hearSent = this.s.vcHear;
      // the microphone: only while in voice and not muted or deafened
      const needMic = join && !this.muted && !this.deaf;
      if (needMic && !this.stream) await this.openMic();
      else if (!needMic && this.stream) this.releaseMic();
      this.changeVolume();
      this.applyMic();
    }
    async openMic() {
      if (this.opening) return;
      this.opening = true;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: this.constraints() });
        if (!(this.joined && !this.muted && !this.deaf)) stream.getTracks().forEach((t) => t.stop()); // not needed anymore
        else this.useStream(stream);
      } catch (e) {
        this.game.toast(e && e.name === 'NotAllowedError' ? '🎤 The game may not use your microphone. Allow it to use voice chat.' : '🎤 No microphone found');
        this.s.vcMuted = true;
      }
      this.opening = false;
      this.render();
    }
    useStream(stream) {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = stream;
      this.watchLevel(stream);
      const track = stream.getAudioTracks()[0] || null;
      for (const p of this.peers.values()) if (p.tx) p.tx.sender.replaceTrack(track).catch(() => {});
      this.applyMic();
    }
    releaseMic() {
      for (const p of this.peers.values()) if (p.tx) p.tx.sender.replaceTrack(null).catch(() => {});
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.myLevel = 0;
      this.render();
    }
    // turn everything off (Settings, logging out)
    stop() {
      for (const id of [...this.peers.keys()]) this.drop(id);
      this.releaseMic();
      if (this.joined && this.net.status === 'online') this.net.send({ t: 'vcState', on: false });
      this.joined = false;
      this.ptt = false;
      this.render();
    }
    // the server lost us (reconnecting): calls end, voice comes back once logged in again
    onDisconnect() { for (const id of [...this.peers.keys()]) this.drop(id); this.joined = false; this.releaseMic(); }
    constraints() {
      const a = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      if (this.s.vcMic) a.deviceId = { exact: this.s.vcMic };
      return a;
    }
    // a new microphone was picked
    async changeMic() {
      if (!this.stream) return this.apply();
      try { this.useStream(await navigator.mediaDevices.getUserMedia({ audio: this.constraints() })); } catch (e) { this.game.toast('🎤 That microphone could not be used'); }
    }
    changeOutput() {
      if (this.ctx && this.ctx.setSinkId) this.ctx.setSinkId(this.s.vcOut || '').catch(() => {});
      for (const p of this.peers.values()) this.sink(p.audio);
    }
    sink(audio) { if (audio && audio.setSinkId && this.s.vcOut) audio.setSinkId(this.s.vcOut).catch(() => {}); }
    // voice volume (up to 200%), nothing while deafened
    changeVolume() {
      const v = this.deaf ? 0 : this.vol();
      for (const p of this.peers.values()) {
        if (p.gain) p.gain.gain.value = v;
        else if (p.audio) { p.audio.muted = this.deaf; p.audio.volume = Math.min(1, v); }
      }
    }
    vol() { return Math.max(0, Math.min(2, this.s.vcVol == null ? 1 : this.s.vcVol)); }
    // push-to-talk: the microphone sends sound only while the key (or 🎤) is held
    applyMic() {
      if (this.stream) this.stream.getAudioTracks().forEach((t) => (t.enabled = this.sending));
      this.render();
    }
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
      if (!this.joined) return;
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
      const peer = { pc, tx: null, name, audio: null, talking: false, queue: [] };
      this.peers.set(id, peer);
      // one audio line both ways; your microphone goes in only while it's open
      if (start) {
        peer.tx = pc.addTransceiver('audio', { direction: 'sendrecv' });
        if (this.stream) peer.tx.sender.replaceTrack(this.stream.getAudioTracks()[0] || null);
      }
      pc.onicecandidate = (e) => { if (e.candidate) this.net.send({ t: 'vcSig', to: id, d: { ice: e.candidate.toJSON() } }); };
      pc.ontrack = (e) => {
        const stream = e.streams[0] || new MediaStream([e.track]);
        // the stream must stay attached to an element for browsers to play it through the 3D sound; that one is silent
        const audio = new Audio();
        audio.autoplay = true;
        audio.srcObject = stream;
        audio.muted = true;
        audio.play().catch(() => {});
        peer.audio = audio;
        try {
          const ctx = this.audioCtx();
          peer.gain = ctx.createGain();
          peer.pan = ctx.createPanner();
          peer.pan.panningModel = 'equalpower'; // left / right only: clean like the lobby (HRTF muffled voices)
          peer.pan.distanceModel = 'linear';
          peer.pan.rolloffFactor = 0; // v1.9.7: never quieter with distance
          peer.pan.refDistance = 1;
          peer.pan.maxDistance = 10000;
          ctx.createMediaStreamSource(stream).connect(peer.gain).connect(peer.pan).connect(ctx.destination);
        } catch (err) {
          // no 3D sound here: plain playback
          peer.gain = peer.pan = null;
          audio.muted = false;
          this.sink(audio);
        }
        this.changeVolume();
        this.watchLevel(stream);
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
            // the other side made the audio line: answer on it, with your microphone if it's open
            peer.tx = pc.getTransceivers().find((t) => t.receiver.track && t.receiver.track.kind === 'audio') || pc.getTransceivers()[0];
            if (peer.tx) {
              peer.tx.direction = 'sendrecv';
              await peer.tx.sender.replaceTrack(this.stream ? this.stream.getAudioTracks()[0] || null : null);
            }
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
      this.peers.delete(id);
    }

    // ======================= who's talking =======================
    // where each voice comes from: in a match from that player's mech (or pilot), heard from the camera; else straight ahead
    place() {
      const ctx = this.ctx, g = this.game;
      if (!ctx || !this.peers.size || !window.THREE) return;
      const L = ctx.listener, T = window.THREE;
      const set3 = (node, names, v) => {
        if (node[names[0]]) names.forEach((n, i) => node[n].setTargetAtTime(v[i], ctx.currentTime, 0.05));
      };
      const inMatch = g.state === 'match' && g.net.active && g.camera;
      let pos = new T.Vector3(), fwd = new T.Vector3(0, 0, -1), up = new T.Vector3(0, 1, 0);
      if (inMatch) {
        g.camera.getWorldPosition(pos);
        const q = new T.Quaternion();
        g.camera.getWorldQuaternion(q);
        fwd.applyQuaternion(q);
        up.applyQuaternion(q);
      }
      if (L.positionX) { set3(L, ['positionX', 'positionY', 'positionZ'], [pos.x, pos.y, pos.z]); set3(L, ['forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ'], [fwd.x, fwd.y, fwd.z, up.x, up.y, up.z]); }
      else if (L.setPosition) { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
      for (const [id, p] of this.peers) {
        if (!p.pan) continue;
        let at = pos.clone().add(fwd); // right in front: both ears
        if (inMatch) {
          const c = g.combatants.find((x) => x.human && x.owner === id);
          const body = c && ((c.pilot && c.pilot.pos) ? c.pilot : c.mech);
          // only the direction counts (a point 2 m away that way), and only half-way to the side, so a voice is never
          // in one ear only
          if (body && body.pos) {
            const d = body.pos.clone().sub(pos);
            if (d.lengthSq() > 0.01) at = pos.clone().add(d.normalize().add(fwd).normalize().multiplyScalar(2));
          }
        }
        if (p.pan.positionX) set3(p.pan, ['positionX', 'positionY', 'positionZ'], [at.x, at.y, at.z]);
        else p.pan.setPosition(at.x, at.y, at.z);
      }
    }
    watchLevel(stream) {
      try {
        this.audioCtx();
        const an = this.ctx.createAnalyser();
        an.fftSize = 512;
        this.ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Uint8Array(an.fftSize);
        stream._level = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); return m / 128; };
      } catch (e) { /* no meter */ }
    }
    level(stream) { return stream && stream._level ? stream._level() : 0; }
    tick() {
      this.myLevel = this.sending ? this.level(this.stream) : 0;
      let changed = false;
      for (const p of this.peers.values()) {
        const talking = !this.deaf && !!p.audio && this.level(p.audio.srcObject) > 0.06;
        if (talking !== p.talking) { p.talking = talking; changed = true; }
      }
      const me = this.myLevel > 0.06;
      if (me !== this.meTalking) { this.meTalking = me; changed = true; }
      // in a match, the game's own sounds get quieter while someone talks (back up half a second after)
      const someone = this.game.state === 'match' && [...this.peers.values()].some((p) => p.talking);
      if (someone) this.duckUntil = performance.now() + 500;
      this.game.setDuck(performance.now() < (this.duckUntil || 0) ? 0.55 : 1);
      if (changed) this.render();
      const meter = $('vcMeter');
      if (meter) meter.style.width = Math.min(100, Math.round(this.myLevel * 250)) + '%';
    }
    // the 🎤 / 🎧 buttons and the list of who's talking
    render() {
      const on = !!this.s.voice;
      const state = !on ? 'off' : this.deaf ? 'deaf' : this.muted ? 'muted' : !this.joined ? 'wait' : this.sending ? 'live' : 'ptt';
      const hide = CW.PORTAL || !this.supported || this.game.talk.mode === 'quick';
      for (const id of ['btnVoice', 'hudVoice']) {
        const b = $(id);
        if (!b) continue;
        b.firstChild.textContent = state === 'muted' || state === 'deaf' ? '🔇' : '🎤';
        b.dataset.vc = state;
        b.classList.toggle('talking', !!this.meTalking && state === 'live');
        b.classList.toggle('hidden', hide);
      }
      for (const id of ['btnDeaf', 'hudDeaf']) {
        const b = $(id);
        if (!b) continue;
        b.firstChild.textContent = this.deaf ? '🔕' : '🎧';
        b.dataset.vc = on ? (this.deaf ? 'deaf' : 'on') : 'off';
        b.classList.toggle('hidden', hide);
      }
      const talking = [...this.peers.values()].filter((p) => p.talking);
      $('vcTalk').innerHTML = talking.map((p) => `<span>🔊 ${esc(p.name)}</span>`).join('');
      $('vcTalk').classList.toggle('hidden', !talking.length);
      $('vcTalk').classList.toggle('in-match', this.game.state === 'match');
      const n = $('vcCount');
      if (n) n.textContent = !on ? '' : this.deaf ? 'deafened' : this.muted ? 'muted' : !this.joined ? '(on when you join a party or a match)' : this.peers.size ? `${this.peers.size} in voice` : 'nobody else yet';
    }
  }

  CW.Voice = Voice;
})();
