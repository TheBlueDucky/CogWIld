// Cogwild — calls (v1.9.7): call a friend or a club-mate who's online, without a party or a match (like Discord).
//
// 📞 Call (Friends, club members, a private chat) rings the other player for 30 seconds; they see a card with your
// picture and Accept / Decline, and hear a ringtone (Settings › Voice chat: built-in tones, your own sound file, volume).
// Once picked up you're in voice with each other (js/voice.js counts a call as someone to talk to) until either hangs up.
// The server (server/talk.js callStart / callAnswer / callEnd) only lets friends and club-mates call, never blocked players.
(function () {
  const CW = window.CW;
  const $ = (id) => document.getElementById(id);
  const esc = CW.esc;
  const MAX_FILE = 1.5 * 1024 * 1024; // your own ringtone is kept on this device (localStorage)
  const FILE_KEY = 'cogwild.ringtone';

  // built-in ringtones: [note frequency, start (s), length (s), wave] played every `every` seconds
  const N = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI note -> Hz
  CW.RINGTONES = [
    { id: 'chime', name: 'Chime', every: 2.6, notes: [[N(72), 0, 0.5, 'sine'], [N(76), 0.16, 0.5, 'sine'], [N(79), 0.32, 0.5, 'sine'], [N(84), 0.48, 0.9, 'sine']] },
    { id: 'marimba', name: 'Marimba', every: 2.4, notes: [[N(79), 0, 0.25, 'triangle'], [N(76), 0.14, 0.25, 'triangle'], [N(72), 0.28, 0.25, 'triangle'], [N(74), 0.42, 0.25, 'triangle'], [N(79), 0.7, 0.4, 'triangle'], [N(84), 0.84, 0.5, 'triangle']] },
    { id: 'classic', name: 'Classic phone', every: 3, notes: [[440, 0, 0.9, 'ring'], [480, 0, 0.9, 'ring'], [440, 1.1, 0.9, 'ring'], [480, 1.1, 0.9, 'ring']] },
    { id: 'digital', name: 'Digital', every: 2, notes: [[1320, 0, 0.08, 'square'], [1320, 0.13, 0.08, 'square'], [1320, 0.26, 0.08, 'square'], [1320, 0.39, 0.08, 'square']] },
    { id: 'bells', name: 'Soft bells', every: 3.2, notes: [[N(67), 0, 1.4, 'sine'], [N(71), 0.45, 1.4, 'sine'], [N(74), 0.9, 1.6, 'sine']] },
  ];

  class Calls {
    constructor(game) {
      this.game = game;
      this.call = null; // { state: 'out' | 'in' | 'live', name, av, pv, since }
      setInterval(() => this.tickTimer(), 1000);
    }
    get s() { return this.game.settings; }
    get net() { return this.game.net; }
    get live() { return !!this.call && this.call.state === 'live'; }

    // ======================= starting, answering, hanging up =======================
    start(name) {
      const g = this.game, v = g.voice;
      if (!g.account.loggedIn) return g.account.openLogin('Log in to call friends');
      if (CW.PORTAL || !v.supported) return g.toast("Calls need voice chat, which this browser or website can't do");
      if (g.talk.mode === 'quick') return g.toast('Calls are off with Quick chat only (Settings › Chat)');
      this.voiceOn();
      this.net.send({ t: 'callStart', to: name });
    }
    // a call needs voice chat: picking up or calling turns it on
    voiceOn() {
      if (this.s.voice) return;
      this.s.voice = true;
      this.s.vcAsked = this.s.vcAsked || 'call';
      this.game.saveProfile();
      this.game.toast('🎤 Voice chat is on for calls (Settings › Voice chat)');
    }
    answer(yes) {
      if (!this.call || this.call.state !== 'in') return;
      if (yes) this.voiceOn();
      this.net.send({ t: 'callAnswer', yes: !!yes });
      this.stopRing();
    }
    hangup() { if (this.call) this.net.send({ t: 'callEnd' }); }

    onMessage(m) {
      if (m.t !== 'call') return false;
      const was = this.call;
      if (m.state === 'end') {
        this.call = null;
        const g = this.game;
        if (m.missed) g.toast(`📞 Missed call from ${m.by}`);
        else if (was && was.state === 'out' && m.why === 'declined') g.toast(`📞 ${was.name} can't talk right now`);
        else if (was && was.state === 'out' && m.why === 'no answer') g.toast(`📞 ${was.name} didn't answer`);
        else if (was && was.state === 'live') g.toast('📞 Call ended');
      } else this.call = { state: m.state, name: m.name, av: m.av | 0, pv: m.pv | 0, since: m.state === 'live' ? (was && was.since) || Date.now() : 0 };
      if (this.call && this.call.state === 'in') this.ring('in');
      else if (this.call && this.call.state === 'out') this.ring('out');
      else this.stopRing();
      this.show(this.call);
      this.game.voice.apply();
      return true;
    }
    // the server lost us: no call any more
    onDisconnect() { if (this.call) { this.call = null; this.stopRing(); this.show(null); } }

    // ======================= the card =======================
    // incoming: picture, name, Accept / Decline; calling: Cancel; in a call: a small bar with the time, 🎤 and hang up
    show(c) {
      const box = $('callCard');
      if (!c) { box.classList.add('hidden'); box.className = 'call-card hidden'; return; }
      const v = this.game.voice;
      box.className = `call-card ${c.state}`;
      const face = CW.face({ name: c.name, av: c.av, pv: c.pv });
      const sub = c.state === 'in' ? 'is calling you…' : c.state === 'out' ? 'Calling…' : `<span id="ccTime">${this.timeText(c)}</span>`;
      const btns = c.state === 'in'
        ? '<button class="cc-btn no" id="ccNo" aria-label="Decline">✕</button><button class="cc-btn yes" id="ccYes" aria-label="Accept">📞</button>'
        : c.state === 'out' ? '<button class="cc-btn no" id="ccEnd" aria-label="Cancel the call">✕</button>'
          : `<button class="cc-btn mic ${v.muted || v.deaf ? 'off' : ''}" id="ccMic" aria-label="Mute your mic">${v.muted || v.deaf ? '🔇' : '🎤'}</button><button class="cc-btn no" id="ccEnd" aria-label="Hang up">✕</button>`;
      box.innerHTML = `<div class="cc-face">${face}</div><div class="cc-txt"><b>${esc(c.name)}</b><small>${sub}</small></div><div class="cc-btns">${btns}</div>`;
      if ($('ccYes')) $('ccYes').onclick = () => this.answer(true);
      if ($('ccNo')) $('ccNo').onclick = () => this.answer(false);
      if ($('ccEnd')) $('ccEnd').onclick = () => this.hangup();
      if ($('ccMic')) $('ccMic').onclick = () => { v.toggleMute(); this.show(this.call); };
    }
    timeText(c) {
      const s = Math.max(0, Math.floor((Date.now() - (c.since || Date.now())) / 1000));
      return `📞 ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    tickTimer() { const t = $('ccTime'); if (t && this.call) t.textContent = this.timeText(this.call); }

    // ======================= ringtones =======================
    ringId() { return this.s.ring || 'chime'; }
    ringVol() { return Math.max(0, Math.min(1, this.s.ringVol == null ? 0.8 : this.s.ringVol)); }
    customRing() { try { return localStorage.getItem(FILE_KEY) || ''; } catch (e) { return ''; } }
    // kind: 'in' = your ringtone; 'out' = a quiet tone while the other player's game rings
    ring(kind) {
      if (this.ringing === kind) return;
      this.stopRing();
      this.ringing = kind;
      if (kind === 'out') return this.loop({ every: 3, notes: [[N(69), 0, 0.7, 'sine'], [N(73), 0, 0.7, 'sine']] }, 0.25);
      const id = this.ringId();
      if (id === 'none') return;
      if (id === 'custom' && this.customRing()) {
        const a = new Audio(this.customRing());
        a.loop = true;
        a.volume = this.ringVol();
        if (this.s.vcOut && a.setSinkId) a.setSinkId(this.s.vcOut).catch(() => {});
        a.play().catch(() => {});
        this.ringAudio = a;
        return;
      }
      this.loop(CW.RINGTONES.find((r) => r.id === id) || CW.RINGTONES[0], 1);
    }
    loop(tone, gain) {
      const play = () => this.playTone(tone, gain);
      play();
      this.ringT = setInterval(play, tone.every * 1000);
    }
    stopRing() {
      this.ringing = null;
      clearInterval(this.ringT);
      if (this.ringAudio) { this.ringAudio.pause(); this.ringAudio = null; }
    }
    // one ring of a built-in tone through the voice chat's sound (same speakers/headphones)
    playTone(tone, gain) {
      let ctx;
      try { ctx = this.game.voice.audioCtx(); } catch (e) { return; }
      const t0 = ctx.currentTime + 0.03, vol = this.ringVol() * gain * 0.22;
      if (vol <= 0) return;
      for (const [f, at, len, wave] of tone.notes) {
        const o = ctx.createOscillator(), env = ctx.createGain();
        o.type = wave === 'ring' ? 'sine' : wave;
        o.frequency.value = f;
        const t = t0 + at;
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(vol, t + 0.015);
        if (wave === 'ring') {
          // the old phone bell: on and off 20 times a second
          const lfo = ctx.createOscillator(), depth = ctx.createGain();
          lfo.frequency.value = 20;
          depth.gain.value = vol * 0.5;
          lfo.connect(depth).connect(env.gain);
          lfo.start(t);
          lfo.stop(t + len + 0.05);
          env.gain.setValueAtTime(vol, t + len - 0.03);
          env.gain.linearRampToValueAtTime(0, t + len);
        } else env.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(env).connect(ctx.destination);
        o.start(t);
        o.stop(t + len + 0.05);
      }
    }
    // Settings › Voice chat › ▶ Try it
    preview() {
      if (this.ringing) return;
      this.ring('in');
      clearTimeout(this.previewT);
      this.previewT = setTimeout(() => { if (!this.call) this.stopRing(); }, 3200);
    }
    // Settings › Voice chat › your own sound file
    pickFile(done) {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'audio/*';
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        if (f.size > MAX_FILE) return this.game.toast('That sound file is too big (1.5 MB at most)');
        const rd = new FileReader();
        rd.onload = () => {
          try { localStorage.setItem(FILE_KEY, rd.result); } catch (e) { return this.game.toast('That sound file is too big to keep'); }
          this.s.ring = 'custom';
          this.s.ringName = f.name.slice(0, 40);
          this.game.saveProfile();
          if (done) done();
        };
        rd.readAsDataURL(f);
      };
      inp.click();
    }
  }

  CW.Calls = Calls;
})();
