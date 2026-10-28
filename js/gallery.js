// Cogwild — the mech gallery (server/gallery.js): browse mechs other players shared (🔥 trending, ⭐ top, 🆕 new,
// ❤ liked, 👤 mine; land / water / air / hybrid; search by name or maker), open one to see it turn in 3D with its
// stats, ❤ like it, 🏁 try it in a test drive, 📋 copy it into your Workshop, or 🚩 report it. 🌍 Share puts one of
// your own mechs in (accounts only). Each card's picture is drawn once by a small renderer and kept.
(function () {
  const CW = window.CW;
  const $ = (id) => document.getElementById(id);
  const SORTS = [['trending', '🔥 Trending'], ['top', '⭐ Top'], ['new', '🆕 New'], ['liked', '❤ Liked'], ['mine', '👤 Mine']];
  const TAGS = [['all', 'All'], ['land', '🚗 Land'], ['water', '🌊 Water'], ['air', '✈ Air'], ['hybrid', '🔀 Mixed']];
  const TAG_ICON = { land: '🚗', water: '🌊', air: '✈' };
  const MSGS = ['galItems', 'galItem', 'galPublished', 'galLiked', 'galCopied', 'galDeleted', 'galGone'];

  // a mech's parts → a group of part meshes (parts as [t, x, y, z, turn, shape] or {t, x, y, z, r, s})
  function mechGroup(parts, color, fin) {
    const grp = new THREE.Group();
    for (const p of parts) {
      const part = Array.isArray(p) ? CW.partFromArr(p) : p;
      if (!CW.PARTS[part.t]) continue;
      grp.add(CW.partMesh(part, color, fin));
    }
    return grp;
  }
  // a tiny studio: lights + a camera that frames a mech from the front-left, a little above
  function studio(r) {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xe4eeff, 0x4a5378, 1.2));
    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(-3, 6, -4);
    scene.add(sun);
    const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
    return { r, scene, cam };
  }
  function frame(st, grp, aspect, yaw) {
    const box = new THREE.Box3().setFromObject(grp), mid = box.getCenter(new THREE.Vector3()), d = box.getSize(new THREE.Vector3()).length();
    const from = new THREE.Vector3(Math.sin(yaw) * 1.15, 0.62, Math.cos(yaw) * 1.15).normalize();
    st.cam.aspect = aspect;
    st.cam.updateProjectionMatrix();
    st.cam.position.copy(mid).addScaledVector(from, d * (aspect < 1.2 ? 1.75 : 1.45));
    st.cam.lookAt(mid);
  }

  class Gallery {
    constructor(game) {
      this.game = game;
      this.q = { sort: 'trending', tag: 'all', q: '', page: 0 };
      this.items = [];
      this.pics = {}; // id -> picture (data URL)
      this.queue = [];
      this.detail = null;
    }
    get net() { return this.game.net; }
    loggedIn() { return !!this.game.account.loggedIn; }
    send(m) {
      this.net.connect().then(() => this.net.send(m)).catch(() => {
        const grid = $('galGrid');
        if (grid) grid.innerHTML = '<div class="small gal-empty">🌐 The gallery needs an internet connection.</div>';
      });
    }
    // opened from the lobby (or back from trying a mech: straight to that mech)
    open(id) {
      this.focus = id || null;
      this.game.meta.openPanel('gallery');
    }

    // ---- the screen ----
    panel(body) {
      const g = this.game;
      body.innerHTML = `<div class="gal-top">
          <div class="gal-sorts">${SORTS.map(([id, l]) => `<button class="ws-btn ${this.q.sort === id ? 'on' : ''}" data-sort="${id}">${l}</button>`).join('')}</div>
          <button class="btn primary gal-share" id="galShare">🌍 Share a mech</button>
        </div>
        <div class="gal-top">
          <div class="gal-sorts">${TAGS.map(([id, l]) => `<button class="tag-chip ${this.q.tag === id ? 'on' : ''}" data-tag="${id}">${l}</button>`).join('')}</div>
          <input id="galSearch" class="gal-search" maxlength="24" spellcheck="false" placeholder="🔍 Search mechs or makers" aria-label="Search mechs or makers" value="${CW.esc(this.q.q)}">
        </div>
        <div id="galGrid" class="gal-grid"><div class="small gal-empty">Loading…</div></div>
        <div id="galMore" class="hidden"><button class="ws-btn" id="galMoreBtn">Show more</button></div>`;
      body.querySelectorAll('[data-sort]').forEach((b) => (b.onclick = () => {
        if ((b.dataset.sort === 'mine' || b.dataset.sort === 'liked') && !this.loggedIn()) return g.account.openLogin('Log in to see your shared and liked mechs');
        this.q.sort = b.dataset.sort; this.reload(body);
      }));
      body.querySelectorAll('[data-tag]').forEach((b) => (b.onclick = () => { this.q.tag = b.dataset.tag; this.reload(body); }));
      let t = 0;
      $('galSearch').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { this.q.q = e.target.value.trim(); this.q.page = 0; this.request(); }, 350); };
      $('galShare').onclick = () => this.shareDialog();
      $('galMoreBtn').onclick = () => { this.q.page++; this.request(); };
      this.q.page = 0;
      this.request();
      if (this.focus) { const id = this.focus; this.focus = null; this.send({ t: 'galGet', id }); }
    }
    reload(body) { this.q.page = 0; this.panel(body); }
    request() { this.send({ t: 'galList', sort: this.q.sort, tag: this.q.tag, q: this.q.q, page: this.q.page }); }
    isOpen() { return this.game.meta.panel === 'gallery' && !$('panel').classList.contains('hidden'); }

    onMessage(m) {
      if (!MSGS.includes(m.t)) return false;
      const g = this.game;
      if (m.t === 'galItems') {
        if (!this.isOpen() || m.sort !== this.q.sort || m.tag !== this.q.tag) return true;
        this.items = m.page ? this.items.concat(m.items) : m.items;
        this.left = m.left;
        this.renderGrid(m);
      } else if (m.t === 'galItem') {
        this.upsert(m.item);
        if (this.isOpen()) this.showDetail(m.item.id);
      } else if (m.t === 'galPublished') {
        g.toast(`🌍 "${m.item.n}" is in the gallery!`);
        g.audio.fanfare();
        this.closeShare();
        this.q.sort = 'mine';
        if (this.isOpen()) this.reload($('panelBody'));
      } else if (m.t === 'galLiked') {
        const it = this.items.find((x) => x.id === m.id);
        if (it) { it.likes = m.likes; it.liked = m.liked; }
        this.refreshCard(m.id);
        if (this.detail === m.id) this.renderDetailInfo();
      } else if (m.t === 'galCopied') {
        const it = this.items.find((x) => x.id === m.id);
        if (it) it.copies = m.copies;
        this.refreshCard(m.id);
        if (this.detail === m.id) this.renderDetailInfo();
      } else if (m.t === 'galDeleted') {
        this.items = this.items.filter((x) => x.id !== m.id);
        this.closeDetail();
        g.toast('🗑 Removed from the gallery');
        if (this.isOpen()) this.renderGrid({ more: false });
      } else if (m.t === 'galGone') {
        g.toast('That mech is no longer in the gallery');
        this.closeDetail();
      }
      return true;
    }
    upsert(it) { const i = this.items.findIndex((x) => x.id === it.id); if (i >= 0) this.items[i] = it; else this.items.push(it); }

    renderGrid(m) {
      const grid = $('galGrid');
      if (!grid) return;
      const empty = { mine: this.loggedIn() ? "You haven't shared a mech yet. Press 🌍 Share a mech!" : 'Log in to share your mechs.', liked: 'Mechs you ❤ show up here.' }[this.q.sort] || (this.q.q ? 'No mechs match that search.' : 'No mechs here yet. Be the first to 🌍 share one!');
      grid.innerHTML = this.items.length ? this.items.map((it) => this.card(it)).join('') : `<div class="small gal-empty">${empty}</div>`;
      grid.querySelectorAll('[data-gal]').forEach((el) => (el.onclick = (e) => {
        if (e.target.closest('[data-like]')) return this.like(el.dataset.gal);
        this.showDetail(el.dataset.gal);
      }));
      $('galMore').classList.toggle('hidden', !m.more);
      for (const it of this.items) if (!this.pics[it.id]) this.queue.push(it);
      this.drawPics();
    }
    card(it) {
      const esc = CW.esc, lock = it.lvl > this.game.level();
      return `<div class="gal-card ${it.hidden ? 'hid' : ''}" data-gal="${it.id}" role="button" tabindex="0" aria-label="${esc(it.n)} by ${esc(it.by)}">
        <div class="gal-pic">${this.pics[it.id] ? `<img src="${this.pics[it.id]}" alt="">` : '<span class="gal-wait">🔧</span>'}<span class="gal-tags">${it.tags.map((t) => TAG_ICON[t]).join('')}</span></div>
        <b>${esc(it.n)}</b>
        <small>by ${esc(it.by)}${it.hidden ? ' · 🚩 hidden while we check it' : ''}</small>
        <div class="gal-row"><button class="gal-like ${it.liked ? 'on' : ''}" data-like="1" aria-label="Like">${it.liked ? '❤' : '🤍'} ${it.likes}</button><span>📋 ${it.copies}</span><span>🔩 ${it.cost}</span>${lock ? `<span class="gal-lock">🔒 Lv ${it.lvl}</span>` : ''}</div>
      </div>`;
    }
    refreshCard(id) {
      const el = document.querySelector(`[data-gal="${id}"]`), it = this.items.find((x) => x.id === id);
      if (!el || !it) return;
      el.outerHTML = this.card(it);
      const nel = document.querySelector(`[data-gal="${id}"]`);
      nel.onclick = (e) => { if (e.target.closest('[data-like]')) return this.like(id); this.showDetail(id); };
    }
    // card pictures, a few per frame so the screen never freezes
    drawPics() {
      if (this.drawing) return;
      this.drawing = true;
      const step = () => {
        if (!this.queue.length || !this.isOpen()) { this.drawing = false; this.queue = []; return; }
        for (let n = 0; n < 3 && this.queue.length; n++) {
          const it = this.queue.shift();
          if (this.pics[it.id]) continue;
          this.pics[it.id] = this.picture(it.parts, it.col, it.fin, 240, 170);
          const img = document.querySelector(`[data-gal="${it.id}"] .gal-pic`);
          if (img && this.pics[it.id]) img.innerHTML = `<img src="${this.pics[it.id]}" alt=""><span class="gal-tags">${it.tags.map((t) => TAG_ICON[t]).join('')}</span>`;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    picture(parts, color, fin, w, h) {
      try {
        if (!this.thumb) {
          const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
          r.setPixelRatio(1);
          this.thumb = studio(r);
        }
        const st = this.thumb;
        st.r.setSize(w, h, false);
        const grp = mechGroup(parts, color, fin);
        st.scene.add(grp);
        frame(st, grp, w / h, -0.75);
        st.r.render(st.scene, st.cam);
        st.scene.remove(grp);
        return st.r.domElement.toDataURL('image/png');
      } catch (e) { return ''; }
    }

    // ---- one mech up close: turning in 3D, its stats and what you can do with it ----
    showDetail(id) {
      const it = this.items.find((x) => x.id === id);
      if (!it) return;
      this.detail = id;
      const box = $('galDetail');
      if (!box) return;
      box.classList.remove('hidden');
      box.innerHTML = `<div class="gal-dbox">
        <button class="ws-btn gal-x" id="galClose" aria-label="Close">✕</button>
        <div class="gal-view" id="galView"></div>
        <div class="gal-info" id="galInfo"></div>
      </div>`;
      $('galClose').onclick = () => this.closeDetail();
      box.onclick = (e) => { if (e.target === box) this.closeDetail(); };
      this.renderDetailInfo();
      this.startView(it);
    }
    renderDetailInfo() {
      const g = this.game, it = this.items.find((x) => x.id === this.detail), el = $('galInfo');
      if (!it || !el) return;
      const esc = CW.esc, parts = it.parts.filter((a) => CW.PARTS[a[0]]).map(CW.partFromArr), s = CW.analyze(parts);
      const kmh = (v) => Math.round(v * 3.6);
      const speeds = [s.domains.has('land') ? `🚗 ${kmh(s.landSpeed)} km/h` : '', s.domains.has('water') ? `🌊 ${kmh(s.waterSpeed)} km/h` : '', s.domains.has('air') ? `✈ ${kmh(s.airSpeed)} km/h` : ''].filter(Boolean).join(' · ');
      const lock = it.lvl > g.level();
      el.innerHTML = `<h2>${esc(it.n)}</h2>
        <div class="small">by <b>${esc(it.by)}</b> · shared ${new Date(it.at).toLocaleDateString()}</div>
        <div class="gal-stats">
          <div><b>❤ ${it.likes}</b><span>likes</span></div><div><b>📋 ${it.copies}</b><span>copies</span></div>
          <div><b>🔩 ${it.cost}</b><span>Bolts</span></div><div><b>${it.parts.length}</b><span>parts</span></div>
          <div><b>${Math.round(s.hp)}</b><span>health</span></div><div><b>${Math.round(s.dps)}</b><span>firepower</span></div>
        </div>
        <div class="small">${speeds || 'Stands still'}${lock ? ` · <span class="gal-lock">🔒 Some parts unlock at level ${it.lvl}: until then it plays online as an example mech</span>` : ''}</div>
        <div class="gal-acts">
          <button class="btn primary" id="galCopy">📋 Copy to my Workshop</button>
          <button class="btn" id="galTry">🏁 Try it</button>
          ${it.mine ? '' : `<button class="btn ${it.liked ? 'on' : ''}" id="galLike">${it.liked ? '❤ Liked' : '🤍 Like'}</button>`}
        </div>
        <div class="gal-acts small">
          ${it.mine ? '<button class="ws-btn" id="galDel">🗑 Remove from the gallery</button>' : '<button class="ws-btn" id="galReport">🚩 Report</button>'}
        </div>
        <div id="galReportBox" class="hidden gal-acts small">Why? <button class="ws-btn" data-why="name">Rude name</button><button class="ws-btn" data-why="rude">Rude shape</button><button class="ws-btn" data-why="copy">Copied from me</button><button class="ws-btn" data-why="other">Something else</button></div>`;
      $('galCopy').onclick = () => this.copy(it);
      $('galTry').onclick = () => this.tryIt(it);
      if ($('galLike')) $('galLike').onclick = () => this.like(it.id);
      if ($('galDel')) $('galDel').onclick = (e) => {
        const b = e.currentTarget;
        if (!b.classList.contains('sure')) { b.classList.add('sure'); b.textContent = 'Remove it? Tap again'; return; }
        this.send({ t: 'galDelete', id: it.id });
      };
      if ($('galReport')) $('galReport').onclick = () => { if (!this.loggedIn()) return g.account.openLogin('Log in to report a mech'); $('galReportBox').classList.toggle('hidden'); };
      el.querySelectorAll('[data-why]').forEach((b) => (b.onclick = () => { this.send({ t: 'galReport', id: it.id, why: b.dataset.why }); $('galReportBox').classList.add('hidden'); }));
    }
    // the big turning picture (drag to turn it yourself)
    startView(it) {
      this.stopView();
      const host = $('galView');
      try {
        const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        const st = studio(r);
        const grp = mechGroup(it.parts, it.col, it.fin);
        st.scene.add(grp);
        const ped = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5, 0.35, 40), CW.mat(0x1d2540));
        const box = new THREE.Box3().setFromObject(grp);
        ped.position.y = box.min.y - 0.2;
        st.scene.add(ped);
        host.appendChild(r.domElement);
        let yaw = -0.75, spin = true, drag = null, last = performance.now();
        r.domElement.addEventListener('pointerdown', (e) => { drag = e.clientX; spin = false; });
        window.addEventListener('pointerup', this.upFn = () => { drag = null; });
        r.domElement.addEventListener('pointermove', (e) => { if (drag !== null) { yaw -= (e.clientX - drag) * 0.01; drag = e.clientX; } });
        const loop = (now) => {
          if (!this.view) return;
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          if (spin) yaw += dt * 0.5;
          const w = host.clientWidth || 320, h = host.clientHeight || 240;
          r.setSize(w, h, false);
          frame(st, grp, w / h, yaw);
          CW.tickFinishes && CW.tickFinishes(dt);
          r.render(st.scene, st.cam);
          this.view.raf = requestAnimationFrame(loop);
        };
        this.view = { r, st, grp, ped };
        this.view.raf = requestAnimationFrame(loop);
      } catch (e) { host.innerHTML = this.pics[it.id] ? `<img src="${this.pics[it.id]}" alt="">` : ''; }
    }
    stopView() {
      if (!this.view) return;
      cancelAnimationFrame(this.view.raf);
      this.view.ped.geometry.dispose();
      this.view.r.dispose();
      if (this.view.r.forceContextLoss) this.view.r.forceContextLoss();
      this.view.r.domElement.remove();
      window.removeEventListener('pointerup', this.upFn);
      this.view = null;
    }
    closeDetail() {
      this.stopView();
      this.detail = null;
      const box = $('galDetail');
      if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
    }
    // Esc: the open mech first, then the share box, then the gallery
    closeTop() {
      if (this.detail) { this.closeDetail(); return true; }
      if (!$('galShareBox').classList.contains('hidden')) { this.closeShare(); return true; }
      return false;
    }

    // ---- actions ----
    like(id) {
      const it = this.items.find((x) => x.id === id);
      if (!it) return;
      if (!this.loggedIn()) return this.game.account.openLogin('Log in to like mechs');
      if (it.mine) return this.game.toast("That's your own mech 😊");
      this.send({ t: 'galLike', id, on: !it.liked });
      this.game.audio.click(1.4);
    }
    bpOf(it) { return { name: it.n.slice(0, 24), color: it.col, parts: it.parts.filter((a) => CW.PARTS[a[0]]).map(CW.partFromArr) }; }
    copy(it) {
      const g = this.game, bp = this.bpOf(it);
      const list = g.blueprints;
      if (list.some((b) => b.name === bp.name)) bp.name = (bp.name.slice(0, 21) + ' 2').slice(0, 24);
      list.unshift(CW.cloneBp(bp));
      g.saveBlueprints();
      g.setCurrentBp(bp);
      this.send({ t: 'galCopy', id: it.id });
      g.audio.click(1.6);
      g.toast(`📋 "${bp.name}" is in your Workshop (and it's your mech now)`);
    }
    tryIt(it) {
      const g = this.game;
      this.closeDetail();
      g.meta.closePanel();
      g.galleryTry = it.id; // T / Back from the test drive comes back here
      g.startTestDrive(CW.cloneBp(this.bpOf(it)));
    }

    // ---- 🌍 share one of your mechs ----
    shareDialog(bp) {
      const g = this.game;
      if (!this.loggedIn()) return g.account.openLogin('Log in to share your mechs in the gallery');
      if (this.left !== undefined && this.left <= 0) return g.toast('You can share 12 mechs. Remove one of yours first (👤 Mine).');
      const mine = [g.currentBp].concat(g.blueprints).filter((b) => b && b.parts && b.parts.length > 1);
      const seen = new Set(), list = mine.filter((b) => { const k = JSON.stringify(b.parts); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 24);
      this.shareList = list;
      const boxEl = $('galShareBox');
      boxEl.classList.remove('hidden');
      boxEl.innerHTML = `<div class="gal-sbox">
        <button class="ws-btn gal-x" id="galShareClose" aria-label="Close">✕</button>
        <h3>🌍 Share a mech</h3>
        <div class="small">Everyone can see it, like it and copy it. Pick one of yours:</div>
        <div class="gal-pick">${list.map((b, i) => `<button class="gal-pcard ${i === 0 ? 'on' : ''}" data-pick="${i}"><img alt="" data-ppic="${i}"><b>${CW.esc(b.name || 'Mech')}</b></button>`).join('')}</div>
        <label class="small">Name <input id="galName" maxlength="24" spellcheck="false" value="${CW.esc((list[0] && list[0].name) || '')}"></label>
        <div class="small">Names with rude words are refused. You can remove it from the gallery any time.</div>
        <div class="gal-acts"><button class="btn primary" id="galSend">🌍 Share it</button></div>
      </div>`;
      let pick = 0;
      if (bp) { const i = list.findIndex((b) => JSON.stringify(b.parts) === JSON.stringify(bp.parts)); if (i >= 0) pick = i; }
      const sel = (i) => {
        pick = i;
        boxEl.querySelectorAll('[data-pick]').forEach((b) => b.classList.toggle('on', +b.dataset.pick === i));
        $('galName').value = (list[i] && list[i].name) || '';
      };
      sel(pick);
      boxEl.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => sel(+b.dataset.pick)));
      list.forEach((b, i) => { const img = boxEl.querySelector(`[data-ppic="${i}"]`); const src = this.picture(b.parts, b.color || g.playerColor, '', 160, 110); if (img && src) img.src = src; });
      $('galShareClose').onclick = () => this.closeShare();
      $('galSend').onclick = () => {
        const b = list[pick];
        if (!b) return;
        const v = CW.validate ? CW.validate(b.parts, 3, CW.BUDGET) : { ok: true };
        if (!v.ok) return g.toast("Fix that mech in the Workshop first (it isn't a working mech yet)");
        this.send({ t: 'galPublish', bp: { name: $('galName').value.trim(), color: b.color || g.playerColor, parts: b.parts, fin: g.profile.finish || '' } });
      };
    }
    closeShare() { const b = $('galShareBox'); if (b) { b.classList.add('hidden'); b.innerHTML = ''; } }
  }

  CW.Gallery = Gallery;
})();
