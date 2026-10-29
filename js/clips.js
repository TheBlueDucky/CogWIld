// Cogwild — clip recorder: press F8 in a match to save the last ~10–20 seconds as a video file.
// Two recorders run staggered and restart every 20 s, so one always holds a recent, valid clip.
(function () {
  const CW = window.CW;
  const CYCLE = 20000; // ms each recorder runs before restarting
  const W = 1280, H = 720;

  class Clips {
    constructor(game) {
      this.game = game;
      this.supported = !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);
      this.slots = [null, null];
      this.running = false;
      this.lastFrame = 0;
    }

    pickMime() {
      const opts = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
      return opts.find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
    }

    start() {
      if (!this.supported || this.running || !this.game.settings.clips) return;
      try {
        this.cv = document.createElement('canvas');
        this.cv.width = W; this.cv.height = H;
        this.ctx = this.cv.getContext('2d');
        this.stream = this.cv.captureStream(30);
        this.mime = this.pickMime();
        this.running = true;
        this.startSlot(0);
        this.stagger = setTimeout(() => this.startSlot(1), CYCLE / 2);
      } catch (e) {
        console.warn('Clip recorder unavailable', e);
        this.supported = false;
      }
    }

    startSlot(i) {
      if (!this.running) return;
      const rec = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime, videoBitsPerSecond: 6000000 } : undefined);
      const slot = { rec, chunks: [], started: performance.now(), save: false };
      rec.ondataavailable = (e) => { if (e.data && e.data.size) slot.chunks.push(e.data); };
      rec.onstop = () => {
        if (slot.save) this.download(slot);
        if (this.slots[i] === slot) this.startSlot(i);
      };
      rec.start(1000);
      slot.timer = setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, CYCLE);
      this.slots[i] = slot;
    }

    stop() {
      this.running = false;
      clearTimeout(this.stagger);
      for (const s of this.slots) {
        if (!s) continue;
        clearTimeout(s.timer);
        if (s.rec.state === 'recording') s.rec.stop();
      }
      this.slots = [null, null];
    }

    // Copy the rendered frame (plus a small watermark) into the recording canvas, ~30 fps
    frame() {
      if (!this.running) return;
      const now = performance.now();
      if (now - this.lastFrame < 33) return;
      this.lastFrame = now;
      const src = this.game.renderer.domElement;
      const ctx = this.ctx;
      // cover-fit the game view into 16:9
      const sa = src.width / src.height, da = W / H;
      let sw = src.width, sh = src.height, sx = 0, sy = 0;
      if (sa > da) { sw = sh * da; sx = (src.width - sw) / 2; } else { sh = sw / da; sy = (src.height - sh) / 2; }
      ctx.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
      ctx.font = 'bold 30px "Lilita One", sans-serif';
      ctx.textAlign = 'right';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText('COGWILD', W - 24, H - 22);
      ctx.fillStyle = '#ffc43d';
      ctx.fillText('COGWILD', W - 24, H - 22);
    }

    // Save the recorder that has been running longest (= the longest recent clip)
    saveClip() {
      if (!this.supported) return this.game.toast('Clips are not supported in this browser');
      if (!this.running) return this.game.toast('Clips record during matches');
      const live = this.slots.filter((s) => s && s.rec.state === 'recording');
      if (!live.length) return;
      const s = live.sort((a, b) => a.started - b.started)[0];
      const secs = Math.round((performance.now() - s.started) / 1000);
      if (secs < 2) return this.game.toast('Clip too short, try again in a moment');
      clearTimeout(s.timer);
      s.save = true;
      s.rec.stop();
      this.game.toast(`🎬 Saving a ${secs}-second clip…`);
      this.game.audio.click(1.6);
      this.game.flashClip();
      if (!this.game.isPractice()) this.game.meta.track('clip');
    }

    // the clip as a video file on this device
    download(slot) {
      const type = (this.mime || 'video/webm').split(';')[0];
      const blob = new Blob(slot.chunks, { type });
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      const d = new Date();
      const name = `cogwild-clip-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}.${ext}`;
      // the desktop app: Documents\Cogwild\Clips (Settings › Display › 📂 opens it); a browser: Downloads
      CW.saveFile('clips', name, blob).then((r) => {
        this.game.toast(r.where ? `🎬 Clip saved in your Clips folder: ${name}` : `🎬 Clip saved: ${name} (check your Downloads)`);
        this.lastSaved = { name, size: blob.size, where: r.where || '' };
      }, () => this.game.toast("🎬 Couldn't save the clip"));
    }
  }

  CW.Clips = Clips;
})();
