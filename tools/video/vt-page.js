// Runs inside the game page (tools/video). A virtual clock: once on, the page's time (performance.now, Date.now,
// timers, requestAnimationFrame) only moves when the recorder steps it, exactly 1/60 s per video frame, however long a
// frame takes to draw and save. The game's sounds go into an OfflineAudioContext on the same clock (rendered a little
// behind it, never played out loud), so picture and sound line up exactly.
(() => {
  if (window.__vt) return;
  const R = {
    now: performance.now.bind(performance), dnow: Date.now,
    st: window.setTimeout.bind(window), ct: window.clearTimeout.bind(window), si: window.setInterval.bind(window), ci: window.clearInterval.bind(window),
    raf: window.requestAnimationFrame.bind(window), caf: window.cancelAnimationFrame.bind(window),
  };
  const V = { on: false, t: 0, t0: 0, d0: 0, id: 1e7, timers: new Map(), rafs: new Map(), frame: -1 };
  const SR = 48000;

  function enable() {
    if (V.on) return;
    V.on = true;
    // a fixed starting time (not the real one): the game's frame times then round exactly the same way in every run,
    // so a seed always plays the same match. The date stays today's (whole seconds).
    V.t = V.t0 = 1e6; V.d0 = Math.floor(R.dnow() / 1000) * 1000;
    performance.now = () => V.t;
    Date.now = () => Math.floor(V.d0 + (V.t - V.t0));
    window.setTimeout = (fn, ms, ...a) => { const id = ++V.id; V.timers.set(id, { at: V.t + Math.max(0, +ms || 0), fn, a, rep: 0 }); return id; };
    window.setInterval = (fn, ms, ...a) => { const id = ++V.id; const m = Math.max(4, +ms || 0); V.timers.set(id, { at: V.t + m, fn, a, rep: m }); return id; };
    window.clearTimeout = window.clearInterval = (id) => { if (!V.timers.delete(id)) { R.ct(id); R.ci(id); } };
    window.requestAnimationFrame = (fn) => { const id = ++V.id; V.rafs.set(id, fn); return id; };
    window.cancelAnimationFrame = (id) => { if (!V.rafs.delete(id)) R.caf(id); };
    // the game's loop only runs from a virtual step: a real screen refresh (or the background worker) that was already
    // on its way is turned into a virtual one instead of running a game step at a random moment
    const g = window.game;
    if (g && !g.__vtLoop) {
      const ol = g.loop.bind(g);
      g.loop = (t) => {
        if (V.inStep) return ol(t);
        if (!g.rafQueued) { g.rafQueued = true; window.requestAnimationFrame((tt) => { g.rafQueued = false; g.loop(tt); }); }
      };
      g.__vtLoop = true;
    }
    // the game's music runs on a timer: start it again on the virtual one
    if (g && g.music && g.music.theme) { const th = g.music.theme; g.music.stop(); g.music.play(th); }
    // the frame marker: a few pixels in the corner whose colour says which frame this is (the recorder checks it)
    let fm = document.getElementById('__fm');
    if (!fm) { fm = document.createElement('div'); fm.id = '__fm'; fm.style.cssText = 'position:fixed;left:0;top:0;width:6px;height:2px;z-index:2147483647;pointer-events:none;background:#000'; document.documentElement.appendChild(fm); }
    V.fm = fm;
  }

  function runTimers() {
    for (let guard = 0; guard < 5000; guard++) {
      let best = null, bid = 0;
      for (const [id, t] of V.timers) if (t.at <= V.t && (!best || t.at < best.at)) { best = t; bid = id; }
      if (!best) return;
      if (best.rep) best.at += best.rep; else V.timers.delete(bid);
      try { typeof best.fn === 'function' ? best.fn(...best.a) : 0; } catch (e) { console.error(e); }
    }
  }

  // one video frame: move the clock, run what's due, draw, set the marker
  function step(frame, ms) {
    V.t += ms;
    V.inStep = true;
    runTimers();
    V.inStep = false;
    const list = [...V.rafs.values()]; V.rafs.clear();
    V.inStep = true; V.watch = true;
    for (const fn of list) { try { fn(V.t); } catch (e) { console.error(e); } }
    V.inStep = false;
    if (V.hook) { try { V.hook(V.t); } catch (e) { console.error(e); } }
    audioPump();
    V.frame = frame;
    V.fm.style.background = `rgb(${frame & 255},${(frame >> 8) & 255},77)`;
    return frame;
  }

  // ---------- sound ----------
  // the game's sound engine gets a stand-in context: an OfflineAudioContext whose "now" is the virtual clock
  function audioStart(maxSecs, ctxHolders) {
    const oac = new OfflineAudioContext(1, Math.ceil(maxSecs * SR), SR);
    const A = { oac, a0: V.t, at: 0, waiting: false, buf: null, done: null };
    const proxy = new Proxy(oac, {
      get(t, k) {
        if (k === 'currentTime') return (V.t - A.a0) / 1000;
        if (k === 'state') return 'running';
        if (k === 'resume' || k === 'suspend' || k === 'close') return () => Promise.resolve();
        const v = Reflect.get(t, k, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    A.proxy = proxy;
    const g = window.game;
    if (g) {
      if (!V.realCtx) V.realCtx = g.audio.ctx;
      g.audio.ctx = proxy; g.audio.eng = null; g.audio.noiseBufs = {}; g.audio.noiseWindow = -1;
      if (g.music) { g.music.gain = null; const th = g.music.theme; if (th) { g.music.stop(); g.music.play(th); } }
    }
    for (const h of ctxHolders || []) h.ctx = proxy;
    const sus = (at) => oac.suspend(at).then(() => { A.at = at; if (A.stopping) oac.resume(); else A.waiting = true; });
    sus(0.25);
    A.done = oac.startRendering().then((b) => { A.buf = b; });
    A.sus = sus;
    V.A = A;
    return true;
  }
  // rendering follows the clock, always a little behind it (so a sound started "now" is never in the past)
  function audioPump() {
    const A = V.A;
    if (!A || !A.waiting) return;
    const now = (V.t - A.a0) / 1000;
    if (now > A.at + 0.35) { A.waiting = false; A.sus(A.at + 0.25); A.oac.resume(); }
  }
  // stop: render the rest, keep the used part as 16-bit samples
  async function audioStop() {
    const A = V.A;
    if (!A) return 0;
    const used = Math.min(A.oac.length, Math.round(((V.t - A.a0) / 1000) * SR));
    // let the rendering run to the end without more stops
    A.stopping = true;
    A.sus = () => Promise.resolve();
    if (A.waiting) { A.waiting = false; A.oac.resume(); }
    await A.done;
    const d = A.buf.getChannelData(0);
    const out = new Int16Array(used);
    for (let i = 0; i < used; i++) { const s = Math.max(-1, Math.min(1, d[i])); out[i] = s * 32767; }
    V.pcm = out; V.A = null;
    // back to the (muted) real sound until the next recorded piece
    const g = window.game;
    if (g && V.realCtx) { g.audio.ctx = V.realCtx; g.audio.eng = null; g.audio.noiseBufs = {}; if (g.music) { g.music.gain = null; const th = g.music.theme; if (th) { g.music.stop(); g.music.play(th); } } }
    return used;
  }
  // the samples, a slice at a time (base64), for the recorder
  function pcmSlice(from, n) {
    const u = new Uint8Array(V.pcm.buffer, from * 2, Math.min(n, V.pcm.length - from) * 2);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // the game's dice from a seed, so a match can be played again exactly (sounds get their own dice: they're made
  // differently while recording than while testing, and must not change the match)
  const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const realRandom = Math.random;
  function seed(n) {
    const rng = mulberry(n);
    V.outside = {};
    Math.random = () => {
      if (!V.inStep && V.watch) { const st = (new Error().stack || '').split(String.fromCharCode(10)).slice(2, 5).join(' | '); V.outside[st] = (V.outside[st] || 0) + 1; }
      return rng();
    };
    const ar = mulberry(n ^ 0x5eed);
    const own = (obj, name) => {
      if (!obj || !obj[name] || obj[name].__own) return;
      const f = obj[name];
      const w = function (...a) { const r = Math.random; Math.random = ar; try { return f.apply(this, a); } finally { Math.random = r; } };
      w.__own = true; obj[name] = w;
    };
    const g = window.game;
    if (g) { own(g.audio, 'noise'); own(g.audio, 'tone'); own(g.audio, 'shot'); own(g.audio, 'boom'); own(g.music, 'drum'); own(g.music, 'schedule'); own(g.music, 'note'); }
    return n;
  }
  window.__vt = { V, R, enable, seed, realRandom, step, audioStart, audioStop, pcmSlice, SR, get now() { return V.t; } };
})();
