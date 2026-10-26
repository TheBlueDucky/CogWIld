// Cogwild — match replays. Every match (not the tutorial or practice) is recorded about 10 times a second: where
// each mech and pilot is, where it aims and whether it shoots, which parts are broken, wrecks, supers, gadgets and
// the kill feed. The last 12 are kept on this device (⭐ keeps one for good). Watch them from the results screen or
// 🎬 Replays in the menu: play/pause, 0.25×–4× speed, a timeline to jump anywhere (wrecks are marked), and a camera
// that follows any mech, orbits it (drag) or flies freely (WASD + drag). Replays can be saved as a file and opened.
(function () {
  const CW = window.CW;
  const V3 = THREE.Vector3;
  const $ = (id) => document.getElementById(id);
  const HZ = 10, MAX_SECS = 900, KEEP = 12, KEEP_STARRED = 40, FORMAT = 1;
  const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100;
  const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const SPEEDS = [0.25, 0.5, 1, 2, 4];
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // ---------------- storage: IndexedDB (a replay is a few hundred KB); the list is kept apart from the data ----------------
  const DB = {
    open() {
      if (!this.p) this.p = new Promise((res, rej) => {
        try {
          const rq = indexedDB.open('cogwild-replays', 1);
          rq.onupgradeneeded = () => { const d = rq.result; d.createObjectStore('meta', { keyPath: 'id' }); d.createObjectStore('data', { keyPath: 'id' }); };
          rq.onsuccess = () => res(rq.result);
          rq.onerror = () => rej(rq.error);
        } catch (e) { rej(e); }
      });
      return this.p;
    },
    async run(store, mode, fn) {
      const d = await this.open();
      return new Promise((res, rej) => {
        const t = d.transaction(store, mode), rq = fn(t.objectStore(store));
        t.oncomplete = () => res(rq ? rq.result : undefined);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    },
    list() { return this.run('meta', 'readonly', (s) => s.getAll()); },
    get(id) { return this.run('data', 'readonly', (s) => s.get(id)); },
    async put(meta, data) { await this.run('data', 'readwrite', (s) => s.put({ id: meta.id, data })); await this.run('meta', 'readwrite', (s) => s.put(meta)); },
    putMeta(meta) { return this.run('meta', 'readwrite', (s) => s.put(meta)); },
    async del(id) { await this.run('meta', 'readwrite', (s) => s.delete(id)); await this.run('data', 'readwrite', (s) => s.delete(id)); },
  };

  // ======================= RECORDING =======================
  class Recorder {
    constructor(game) {
      this.game = game;
      this.rec = null;
      // supers and gadgets: note who used what (the replay shows a burst in their colors)
      const self = this;
      const sEff = game.supers.effect, gEff = game.gadgets.effect;
      game.supers.effect = function (c, type) { self.event({ k: 'super', i: self.idx(c), type }); return sEff.apply(this, arguments); };
      game.gadgets.effect = function (c, type) { self.event({ k: 'gadget', i: self.idx(c), type }); return gEff.apply(this, arguments); };
    }
    recording() { return !!this.rec; }
    begin() {
      const g = this.game;
      this.rec = {
        v: FORMAT, mode: g.modeId, format: g.formatId, arena: g.world.arena.id, tod: g.timeOfDay, at: Date.now(),
        online: !!g.net.active, roster: [], frames: [], events: [], t: 0, acc: 1, ids: new Map(), lastBits: [], lastMech: [],
      };
    }
    // a combatant's number in this recording (added the first time it's seen: waves, minions and late joiners too)
    idx(c) {
      const r = this.rec;
      if (!r || !c) return -1;
      let i = r.ids.get(c);
      if (i !== undefined) return i;
      const m = c.mech;
      i = r.roster.length;
      r.ids.set(c, i);
      r.roster.push({
        n: String(c.name || '').slice(0, 20), col: c.color | 0, tm: c.team | 0, me: c.isPlayer ? 1 : 0, h: c.human ? 1 : 0, t0: r2(r.t),
        fin: (m && m.fin) || '', parts: m ? m.parts.map((p) => [p.t, p.x, p.y, p.z]) : [], r: m ? r1(m.radius) : 2,
      });
      return i;
    }
    event(e) {
      const r = this.rec;
      if (!r || e.i < 0) return;
      e.t = r2(r.t);
      r.events.push(e);
    }
    // every match frame (the game's tick)
    tick(dt) {
      const g = this.game;
      if (g.isPractice() || g.tutorial.active) return;
      if (!this.rec) this.begin();
      const r = this.rec;
      r.t += dt;
      if (r.t > MAX_SECS) return;
      r.acc += dt;
      if (r.acc < 1 / HZ) return;
      r.acc = Math.min(r.acc - 1 / HZ, 1 / HZ);
      const ms = [], ps = [];
      for (const c of g.combatants) {
        const i = this.idx(c), m = c.mech;
        if (m && m.alive) {
          // a new mech (respawned): all its parts are back
          if (r.lastMech[i] !== m) { r.lastMech[i] = m; r.lastBits[i] = null; }
          const bits = m.parts.map((p) => (p.alive ? 1 : 0)).join('');
          if (bits !== r.lastBits[i]) { r.lastBits[i] = bits; this.event({ k: 'parts', i, b: bits }); }
          const a = m.input.aim, fire = m.occupied && m.input.fire && a;
          const f = (fire ? 1 : 0) | (m.occupied ? 2 : 0) | (m.dashTime > 0 ? 4 : 0) | (m.protect > 0 || m.domeT > 0 ? 8 : 0);
          ms.push([i, r2(m.pos.x), r2(m.pos.y), r2(m.pos.z), r2(m.yaw), r2(m.pitch), r2(m.roll), f].concat(fire ? [r1(a.x), r1(a.y), r1(a.z)] : []));
        }
        const p = c.pilot;
        if (p && p.alive) ps.push([i, r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r2(p.yaw)]);
      }
      const fr = [r2(r.t), ms];
      if (ps.length) fr.push(ps);
      r.frames.push(fr);
    }
    // the game's hooks
    wreck(mech) { const r = this.rec; if (!r) return; this.event({ k: 'wreck', i: this.idx(mech.combatant), x: r1(mech.pos.x), y: r1(mech.pos.y), z: r1(mech.pos.z) }); }
    feed(msg, cls) { if (this.rec && this.game.state === 'match') this.event({ k: 'feed', i: 0, m: String(msg).slice(0, 120), c: cls || '' }); }
    // the match is over (results) or was left: keep it if it's long enough. Returns the saved replay's id (a promise)
    finish(result) {
      const r = this.rec;
      this.rec = null;
      if (!r || r.frames.length < HZ * 15) return Promise.resolve(null);
      const g = this.game, me = r.roster.find((x) => x.me);
      const meta = {
        id: 'r' + r.at.toString(36) + Math.floor(Math.random() * 1e4).toString(36), at: r.at, mode: r.mode, format: r.format, arena: r.arena,
        secs: Math.round(r.frames[r.frames.length - 1][0]), result: result ? String(result).slice(0, 60) : 'Left the match', online: r.online,
        players: r.roster.filter((x) => !x.mn).length, me: me ? me.n : '', star: false, v: FORMAT,
      };
      const data = { v: FORMAT, mode: r.mode, format: r.format, arena: r.arena, tod: r.tod, at: r.at, roster: r.roster, frames: r.frames, events: r.events };
      const saved = DB.put(meta, data).then(() => this.prune()).then(() => meta.id).catch((e) => { console.warn('replay not saved', e); return null; });
      g.lastReplay = saved;
      return saved;
    }
    // keep the newest unstarred ones and every starred one (up to a limit)
    async prune() {
      const list = (await DB.list()).sort((a, b) => b.at - a.at);
      const plain = list.filter((x) => !x.star), starred = list.filter((x) => x.star);
      for (const x of plain.slice(KEEP).concat(starred.slice(KEEP_STARRED))) await DB.del(x.id);
    }
  }

  // ======================= WATCHING =======================
  class Replays {
    constructor(game) {
      this.game = game;
      this.recorder = new Recorder(game);
      this.on = false;
      this.bindUi();
    }

    // ---- the 🎬 Replays menu ----
    async panel(body) {
      const g = this.game, esc = CW.esc;
      body.innerHTML = '<div class="small">Loading…</div>';
      let list = [];
      try { list = (await DB.list()).sort((a, b) => b.at - a.at); } catch (e) { body.innerHTML = '<div class="small">Replays can\'t be saved in this browser (private mode?).</div>'; return; }
      const files = !window.Capacitor; // the Android app can't save or open files from here
      const rows = list.map((x) => {
        const m = CW.MODES[x.mode] || { icon: '🎮', name: x.mode }, a = CW.ARENAS[x.arena] || { icon: '🗺', name: x.arena };
        const when = new Date(x.at);
        return `<div class="rp-row ${x.star ? 'star' : ''}">
          <span class="rp-ico">${m.icon}</span>
          <div class="rp-info"><b>${esc(m.name)} · ${a.icon} ${esc(a.name)}</b><small>${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${fmt(x.secs)} · ${esc(x.result)}${x.online ? ' · 🌐 online' : ''}</small></div>
          <button class="ws-btn on" data-watch="${x.id}">▶ Watch</button>
          <button class="ws-btn" data-star="${x.id}" aria-label="${x.star ? 'Stop keeping it' : 'Keep it for good'}">${x.star ? '⭐' : '☆'}</button>
          ${files ? `<button class="ws-btn" data-file="${x.id}" aria-label="Save as a file">💾</button>` : ''}
          <button class="ws-btn" data-del="${x.id}" aria-label="Delete">🗑</button>
        </div>`;
      }).join('');
      body.innerHTML = `<div class="small">Your last ${KEEP} matches are kept on this device. ☆ keeps one for good${files ? ', 💾 saves it as a file you can send to a friend' : ''}.</div>
        <div class="rp-list">${rows || '<div class="small" style="padding:18px 4px">No replays yet: play a match and it shows up here.</div>'}</div>
        ${files ? '<div class="other-play"><button class="ws-btn" id="rpOpenFile">📂 Open a replay file</button><input type="file" id="rpFileIn" accept=".cwreplay,.json" class="hidden"></div>' : ''}`;
      body.querySelectorAll('[data-watch]').forEach((b) => (b.onclick = () => this.watch(b.dataset.watch)));
      body.querySelectorAll('[data-star]').forEach((b) => (b.onclick = async () => {
        const x = list.find((y) => y.id === b.dataset.star);
        x.star = !x.star;
        await DB.putMeta(x);
        g.toast(x.star ? '⭐ Kept for good' : 'It goes when newer replays come in');
        this.panel(body);
      }));
      // delete: tap once more to be sure
      body.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
        if (!b.classList.contains('sure')) { b.classList.add('sure'); b.textContent = 'Delete?'; return; }
        await DB.del(b.dataset.del);
        this.panel(body);
      }));
      body.querySelectorAll('[data-file]').forEach((b) => (b.onclick = async () => {
        const rec = await DB.get(b.dataset.file), x = list.find((y) => y.id === b.dataset.file);
        if (!rec) return;
        const blob = new Blob([JSON.stringify({ cogwildReplay: FORMAT, meta: x, data: rec.data })], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `cogwild-${x.mode}-${x.arena}-${new Date(x.at).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.cwreplay`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }));
      if (files) {
        $('rpOpenFile').onclick = () => $('rpFileIn').click();
        $('rpFileIn').onchange = async (e) => {
          const f = e.target.files && e.target.files[0];
          if (!f) return;
          try {
            const j = JSON.parse(await f.text());
            if (!j || j.cogwildReplay !== FORMAT || !j.data || !Array.isArray(j.data.frames) || !CW.ARENAS[j.data.arena]) throw new Error('bad');
            this.play(j.data, j.meta || {});
          } catch (err) { g.toast("That isn't a Cogwild replay file (or it's from a newer version)"); }
        };
      }
    }
    async watch(id) {
      const g = this.game;
      try {
        const rec = await DB.get(id);
        const meta = (await DB.list()).find((x) => x.id === id) || {};
        if (!rec || !rec.data) return g.toast('That replay is gone');
        this.play(rec.data, meta);
      } catch (e) { g.toast("Couldn't open the replay"); }
    }

    // ---- the viewer ----
    play(d, meta) {
      const g = this.game;
      if (!d || !d.frames || d.frames.length < 2 || !CW.ARENAS[d.arena]) return g.toast("Couldn't open the replay");
      g.meta.closePanel();
      g.hideAll();
      g.endMatch();
      this.close(true);
      g.net.leaveQuiet();
      g.state = 'replay';
      g.setArena(d.arena);
      g.timeOfDay = CW.TIMES[d.tod] ? d.tod : 'day';
      g.world.applyTime(g.timeOfDay, g);
      if (g.showcase) g.showcase.visible = false;
      this.d = d;
      this.meta = meta;
      this.dur = d.frames[d.frames.length - 1][0];
      this.t = d.frames[0][0];
      this.k = 0;
      this.speed = 1;
      this.playing = true;
      this.on = true;
      this.camMode = 'follow';
      // the mechs as they look (part meshes in their colors), a pilot figure and a name tag each
      this.mechs = d.roster.map((e, i) => this.buildMech(e, i));
      // per mech: when its parts changed; events in time order
      this.partsAt = d.roster.map(() => []);
      for (const e of d.events) if (e.k === 'parts' && this.partsAt[e.i]) this.partsAt[e.i].push(e);
      this.events = d.events.filter((e) => e.k !== 'parts');
      this.follow = Math.max(0, d.roster.findIndex((e) => e.me));
      this.orbit = { yaw: 0.6, pitch: 0.35, dist: 14 };
      this.free = { pos: null, yaw: 0, pitch: -0.2 };
      this.camPos = null;
      // timeline marks: wrecks
      $('rpMarks').innerHTML = this.events.filter((e) => e.k === 'wreck').map((e) => `<i style="left:${(e.t / this.dur) * 100}%"></i>`).join('');
      const m = CW.MODES[d.mode] || { icon: '🎮', name: d.mode }, a = CW.ARENAS[d.arena];
      $('rpTitle').textContent = `🎬 ${m.icon} ${m.name} · ${a.icon} ${a.name}`;
      $('rpSub').textContent = `${new Date(d.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${meta && meta.result ? ' · ' + meta.result : ''}`;
      $('rpFeed').innerHTML = '';
      $('replayUi').classList.remove('hidden', 'rp-hidden');
      this.seek(this.t, true);
      this.renderUi();
    }
    buildMech(e, i) {
      const g = this.game, grp = new THREE.Group();
      grp.rotation.order = 'YXZ';
      const parts = e.parts.map(([t, x, y, z]) => {
        const obj = CW.PARTS[t] ? CW.buildPartMesh(t, e.col, e.fin) : new THREE.Group();
        obj.position.set(x, y, z);
        grp.add(obj);
        const w = CW.PARTS[t] && CW.PARTS[t].weapon;
        return { t, obj, alive: true, w, cd: Math.random() * 0.3 };
      });
      grp.visible = false;
      g.scene.add(grp);
      // the pilot on foot: a little figure in the team color
      const pil = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.9, 10), CW.mat(e.col));
      body.position.y = 0.45;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), CW.mat(0xffd6a5));
      head.position.y = 1.12;
      pil.add(body, head);
      pil.visible = false;
      g.scene.add(pil);
      // name tag
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 48;
      const ctx = cv.getContext('2d');
      ctx.font = 'bold 28px Nunito, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(e.n, 128, 24);
      ctx.fillStyle = '#' + (e.col | 0).toString(16).padStart(6, '0');
      ctx.fillText(e.n, 128, 24);
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthWrite: false, transparent: true }));
      tag.scale.set(4, 0.75, 1);
      g.scene.add(tag);
      return { e, grp, parts, pil, tag, bits: null, shown: false, pos: new V3(), yaw: 0, fire: false, aim: new V3(), occupied: true };
    }
    close(quiet) {
      const g = this.game;
      if (!this.on) return;
      this.on = false;
      for (const m of this.mechs || []) {
        g.scene.remove(m.grp, m.pil, m.tag);
        m.tag.material.map.dispose(); m.tag.material.dispose();
        m.pil.children.forEach((c) => c.geometry.dispose());
      }
      this.mechs = [];
      g.fx.clear();
      $('replayUi').classList.add('hidden');
      if (!quiet) g.showMenu();
    }

    // jump to a time: parts and positions as they were then (nothing replays on the way)
    seek(t, quiet) {
      this.t = Math.max(this.d.frames[0][0], Math.min(this.dur, t));
      const f = this.d.frames;
      let lo = 0, hi = f.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (f[mid][0] <= this.t) lo = mid; else hi = mid - 1; }
      this.k = lo;
      this.lastT = this.t;
      if (!quiet) this.game.fx.clear();
      this.apply(true);
    }
    // the parts a mech had at time t
    bitsAt(i, t) {
      const list = this.partsAt[i];
      let b = null;
      for (const e of list) { if (e.t > t) break; b = e.b; }
      return b;
    }
    update(dt) {
      if (!this.on) return;
      const g = this.game;
      if (this.playing) {
        const prev = this.t;
        this.t = Math.min(this.dur, this.t + dt * this.speed);
        const f = this.d.frames;
        while (this.k < f.length - 2 && f[this.k + 1][0] <= this.t) this.k++;
        // what happened in between: wrecks, supers, gadgets, the feed
        for (const e of this.events) if (e.t > prev && e.t <= this.t) this.happen(e);
        this.lastT = this.t;
        if (this.t >= this.dur) { this.playing = false; this.renderUi(); }
        this.apply(false, dt * this.speed);
      }
      this.updateCamera(dt);
      // the timeline follows (not while it's being dragged)
      if (!this.dragging) $('rpSeek').value = Math.round((this.t / this.dur) * 1000);
      $('rpTime').textContent = `${fmt(this.t)} / ${fmt(this.dur)}`;
    }
    // positions between two frames, parts, shooting
    apply(jump, dt) {
      const g = this.game, f = this.d.frames, a = f[this.k], b = f[Math.min(f.length - 1, this.k + 1)];
      const span = b[0] - a[0], u = span > 0 ? Math.max(0, Math.min(1, (this.t - a[0]) / span)) : 0;
      const seen = new Set();
      const nb = new Map();
      for (const s of b[1]) nb.set(s[0], s);
      for (const s of a[1]) {
        const m = this.mechs[s[0]];
        if (!m) continue;
        seen.add(s[0]);
        const n = nb.get(s[0]);
        const lerp = (x, y) => x + (y - x) * u;
        m.pos.set(n ? lerp(s[1], n[1]) : s[1], n ? lerp(s[2], n[2]) : s[2], n ? lerp(s[3], n[3]) : s[3]);
        m.yaw = n ? s[4] + wrapA(n[4] - s[4]) * u : s[4];
        m.grp.position.copy(m.pos);
        m.grp.rotation.set(n ? lerp(s[5], n[5]) : s[5], m.yaw, n ? lerp(s[6], n[6]) : s[6]);
        m.occupied = !!(s[7] & 2);
        m.fire = !!(s[7] & 1) && s.length > 8;
        if (m.fire) m.aim.set(s[8], s[9], s[10]);
        if (!m.shown) { m.shown = true; m.grp.visible = true; }
        // broken parts
        const bits = this.bitsAt(s[0], this.t);
        if (bits && bits !== m.bits) {
          for (let i = 0; i < m.parts.length; i++) {
            const alive = bits[i] !== '0', p = m.parts[i];
            if (p.alive && !alive && !jump) { m.grp.updateMatrixWorld(true); g.fx.burst(p.obj.getWorldPosition(new V3()), { n: 8, color: 'spark', speed: 7, life: 0.4, size: 0.2, grav: 12 }); }
            p.alive = alive;
            p.obj.visible = alive;
          }
          m.bits = bits;
        }
      }
      for (let i = 0; i < this.mechs.length; i++) if (!seen.has(i) && this.mechs[i].shown) { this.mechs[i].shown = false; this.mechs[i].grp.visible = false; this.mechs[i].fire = false; }
      // pilots on foot
      const pa = new Map((a[2] || []).map((p) => [p[0], p])), pb = new Map((b[2] || []).map((p) => [p[0], p]));
      for (let i = 0; i < this.mechs.length; i++) {
        const m = this.mechs[i], p = pa.get(i), q = pb.get(i);
        m.pil.visible = !!p;
        if (p) {
          m.pil.position.set(q ? p[1] + (q[1] - p[1]) * u : p[1], q ? p[2] + (q[2] - p[2]) * u : p[2], q ? p[3] + (q[3] - p[3]) * u : p[3]);
          m.pil.rotation.y = p[4];
        }
        // the name tag over the mech or the pilot
        const at = m.shown ? m.pos : p ? m.pil.position : null;
        m.tag.visible = !!at && this.showTags !== false;
        if (at) m.tag.position.set(at.x, at.y + (m.shown ? m.e.r + 1.2 : 2), at.z);
      }
      if (!jump && dt) this.shoot(dt);
    }
    // shots: each weapon fires at its own rate toward where the mech was aiming (the bullets end at that point)
    shoot(dt) {
      const g = this.game, fx = g.fx;
      for (const m of this.mechs) {
        if (!m.shown || !m.fire) continue;
        m.grp.updateMatrixWorld(true);
        for (const p of m.parts) {
          if (!p.alive || !p.w) continue;
          p.cd -= dt;
          if (p.cd > 0) continue;
          p.cd = 1 / p.w.rate;
          const start = p.obj.getWorldPosition(new V3());
          start.y += 0.12;
          const dir = m.aim.clone().sub(start), dist = dir.length();
          if (dist < 1) continue;
          dir.normalize();
          start.addScaledVector(dir, 0.8);
          if (p.w.kind === 'laser') { fx.laser(start, dir, Math.min(p.w.range, dist), 0, null); continue; }
          fx.projectile({ pos: start, vel: dir.clone().multiplyScalar(p.w.speed), dmg: 0, splash: 0, grav: 0, who: null, kind: p.w.kind });
          const shot = fx.projectiles[fx.projectiles.length - 1];
          if (shot) { shot.life = Math.min(shot.life, dist / p.w.speed); shot.maxLife = shot.life; }
          if (p.w.kind !== 'flame') fx.later(dist / p.w.speed, () => this.on && fx.burst(m.aim.clone(), { n: p.w.splash ? 10 : 3, color: p.w.splash ? 'fire' : 'spark', speed: p.w.splash ? 6 : 4, life: 0.3, size: p.w.splash ? 0.5 : 0.15 }));
          g.audio.shot(p.w.kind, g.audio.near(start) * 0.6);
        }
      }
    }
    happen(e) {
      const g = this.game, fx = g.fx, m = this.mechs[e.i];
      if (e.k === 'wreck') {
        const at = new V3(e.x, e.y, e.z);
        fx.explosion(at, 1.1);
        fx.chunks(at, 8, m ? m.e.col : 0x888888);
        fx.later(0.28, () => { if (!this.on) return; fx.explosion(at, 2.6); fx.chunks(at, 10, m ? m.e.col : 0x888888); fx.shockwave(at); fx.burst(at, { n: 8, color: 'smoke', speed: 2, up: 5, life: 2.2, size: 0.9, grow: 2.5 }); });
        g.audio.boom(1, at);
      } else if ((e.k === 'super' || e.k === 'gadget') && m && m.shown) {
        fx.burst(m.pos, { n: e.k === 'super' ? 30 : 14, color: fx.colorKey(m.e.col), speed: e.k === 'super' ? 12 : 6, life: 0.6, size: 0.35 });
        if (e.k === 'super') fx.shockwave(m.pos);
      } else if (e.k === 'feed') {
        const el = document.createElement('div');
        el.className = 'feed-item ' + (e.c || '');
        el.textContent = e.m;
        $('rpFeed').prepend(el);
        setTimeout(() => el.remove(), 6000 / Math.max(1, this.speed));
        while ($('rpFeed').children.length > 5) $('rpFeed').lastChild.remove();
      }
    }

    // ---- camera: follow (behind the mech), orbit (drag around it), free (WASD + drag) ----
    target() {
      const m = this.mechs[this.follow];
      if (!m) return null;
      return m.shown ? m.pos : m.pil.visible ? m.pil.position : null;
    }
    updateCamera(dt) {
      const g = this.game, cam = g.camera;
      const k = 1 - Math.exp(-6 * dt);
      if (this.camMode === 'free') {
        const f = this.free;
        if (!f.pos) f.pos = cam.position.clone();
        const sp = (g.keys.ShiftLeft || g.keys.ShiftRight ? 60 : 22) * dt;
        const fw = new V3(-Math.sin(f.yaw) * Math.cos(f.pitch), Math.sin(f.pitch), -Math.cos(f.yaw) * Math.cos(f.pitch)), rt = new V3(Math.cos(f.yaw), 0, -Math.sin(f.yaw));
        if (g.keys.KeyW) f.pos.addScaledVector(fw, sp);
        if (g.keys.KeyS) f.pos.addScaledVector(fw, -sp);
        if (g.keys.KeyD) f.pos.addScaledVector(rt, sp);
        if (g.keys.KeyA) f.pos.addScaledVector(rt, -sp);
        if (g.keys.KeyE || g.keys.Space) f.pos.y += sp;
        if (g.keys.KeyQ) f.pos.y -= sp;
        f.pos.y = Math.max(f.pos.y, g.world.groundAt(f.pos.x, f.pos.z) + 1);
        cam.position.copy(f.pos);
        cam.lookAt(f.pos.clone().add(fw));
        return;
      }
      const tp = this.target();
      if (!tp) return;
      const m = this.mechs[this.follow];
      let want;
      if (this.camMode === 'orbit') {
        const o = this.orbit;
        want = new V3(tp.x + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist, tp.y + Math.sin(o.pitch) * o.dist, tp.z + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist);
      } else {
        const d = 6 + m.e.r * 1.6, yaw = m.shown ? m.yaw : m.pil.rotation.y;
        want = new V3(tp.x + Math.sin(yaw) * d, tp.y + 2.5 + m.e.r * 0.5, tp.z + Math.cos(yaw) * d);
      }
      want.y = Math.max(want.y, g.world.groundAt(want.x, want.z) + 1.2);
      if (!this.camPos || this.camPos.distanceTo(want) > 60) this.camPos = want.clone();
      else this.camPos.lerp(want, this.camMode === 'orbit' ? 1 : k);
      cam.position.copy(this.camPos);
      cam.lookAt(tp.x, tp.y + 1, tp.z);
    }
    nextMech(dir) {
      const n = this.mechs.length;
      for (let s = 1; s <= n; s++) {
        const i = (this.follow + dir * s + n * 4) % n, m = this.mechs[i];
        if (m.shown || m.pil.visible) { this.follow = i; break; }
      }
      this.camPos = null;
      if (this.camMode === 'free') this.camMode = 'follow';
      this.renderUi();
    }
    setCam(mode) {
      this.camMode = mode || { follow: 'orbit', orbit: 'free', free: 'follow' }[this.camMode];
      if (this.camMode === 'free') { const c = this.game.camera, d = new V3(); c.getWorldDirection(d); this.free = { pos: c.position.clone(), yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(Math.max(-1, Math.min(1, d.y))) }; }
      if (this.camMode === 'orbit') { const tp = this.target(), c = this.game.camera.position; if (tp) { this.orbit.yaw = Math.atan2(c.x - tp.x, c.z - tp.z); this.orbit.dist = Math.max(6, Math.min(40, c.distanceTo(tp))); } }
      this.renderUi();
    }
    renderUi() {
      if (!this.on) return;
      $('rpPlay').textContent = this.playing ? '⏸' : this.t >= this.dur ? '⟲' : '▶';
      $('rpSpeed').textContent = this.speed + '×';
      $('rpCam').textContent = { follow: '🎥 Follow', orbit: '🌀 Orbit', free: '🕊 Free' }[this.camMode];
      const m = this.mechs[this.follow];
      $('rpWho').textContent = m ? m.e.n : '';
      $('rpWho').style.color = m ? '#' + (m.e.col | 0).toString(16).padStart(6, '0') : '';
    }
    toggle() {
      if (this.t >= this.dur) { this.seek(0); this.playing = true; } else this.playing = !this.playing;
      this.renderUi();
    }
    bindUi() {
      const g = this.game;
      $('rpExit').onclick = () => this.close();
      $('rpPlay').onclick = () => this.toggle();
      $('rpBack').onclick = () => this.seek(this.t - 10);
      $('rpFwd').onclick = () => this.seek(this.t + 10);
      $('rpSpeed').onclick = () => { this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length]; this.renderUi(); };
      $('rpPrev').onclick = () => this.nextMech(-1);
      $('rpNext').onclick = () => this.nextMech(1);
      $('rpCam').onclick = () => this.setCam();
      $('rpHide').onclick = () => $('replayUi').classList.add('rp-hidden');
      $('rpShow').onclick = () => $('replayUi').classList.remove('rp-hidden');
      const sk = $('rpSeek');
      sk.oninput = () => { this.dragging = true; this.seek((sk.value / 1000) * this.dur); };
      sk.onchange = () => { this.dragging = false; };
      window.addEventListener('keydown', (e) => {
        if (!this.on || g.state !== 'replay' || /INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '') && document.activeElement !== sk) return;
        const k = e.code;
        if (k === 'Space' && this.camMode !== 'free') { e.preventDefault(); this.toggle(); }
        else if (k === 'ArrowLeft') { e.preventDefault(); this.seek(this.t - 5); }
        else if (k === 'ArrowRight') { e.preventDefault(); this.seek(this.t + 5); }
        else if (k === 'ArrowUp') { e.preventDefault(); this.speed = SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(this.speed) + 1)]; this.renderUi(); }
        else if (k === 'ArrowDown') { e.preventDefault(); this.speed = SPEEDS[Math.max(0, SPEEDS.indexOf(this.speed) - 1)]; this.renderUi(); }
        else if (k === 'Tab') { e.preventDefault(); this.nextMech(e.shiftKey ? -1 : 1); }
        else if (k === 'KeyC') this.setCam();
        else if (k === 'KeyH') $('replayUi').classList.toggle('rp-hidden');
        else if (k === 'KeyP') { if (this.camMode === 'free') this.toggle(); }
      });
      // dragging on the 3D view turns the orbit / free camera (mouse or finger)
      const view = g.renderer.domElement;
      let drag = null;
      view.addEventListener('pointerdown', (e) => {
        if (!this.on) return;
        drag = { x: e.clientX, y: e.clientY };
        if (this.camMode === 'follow') this.setCam('orbit');
      });
      window.addEventListener('pointermove', (e) => {
        if (!this.on || !drag) return;
        const dx = (e.clientX - drag.x) * 0.006, dy = (e.clientY - drag.y) * 0.006;
        drag = { x: e.clientX, y: e.clientY };
        if (this.camMode === 'orbit') { this.orbit.yaw -= dx; this.orbit.pitch = Math.max(-0.1, Math.min(1.4, this.orbit.pitch + dy)); }
        else if (this.camMode === 'free') { this.free.yaw -= dx; this.free.pitch = Math.max(-1.4, Math.min(1.4, this.free.pitch - dy)); }
      });
      window.addEventListener('pointerup', () => { drag = null; });
      view.addEventListener('wheel', (e) => { if (this.on && this.camMode === 'orbit') this.orbit.dist = Math.max(5, Math.min(60, this.orbit.dist * (e.deltaY > 0 ? 1.12 : 0.89))); }, { passive: true });
    }
  }

  CW.Replays = Replays;
  CW.ReplayDB = DB;
})();
