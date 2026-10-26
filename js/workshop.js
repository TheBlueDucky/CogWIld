// Cogwild — Workshop: snap building, stats, blueprints, Rush Build
(function () {
  const CW = window.CW;
  const $ = (id) => document.getElementById(id);
  const MAX_HISTORY = 80;

  // small pictures of every part for the part list: each part drawn once (front-left, from a little above) by a tiny
  // renderer of its own, which is thrown away afterwards
  CW.partPictures = function () {
    if (CW._partPics) return CW._partPics;
    const pics = {};
    let r = null;
    try {
      const S = 96;
      r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setPixelRatio(1);
      r.setSize(S, S, false);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xe4eeff, 0x4a5378, 1.3));
      scene.add(new THREE.AmbientLight(0xffffff, 0.35)); // dark parts (tires, bumpers) stay readable
      const sun = new THREE.DirectionalLight(0xffffff, 1);
      sun.position.set(-3, 5, -4);
      scene.add(sun);
      const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
      const box = new THREE.Box3(), mid = new THREE.Vector3(), size = new THREE.Vector3();
      const from = new THREE.Vector3(-0.85, 0.7, -1.15).normalize();
      for (const id of Object.keys(CW.PARTS)) {
        const m = CW.buildPartMesh(id, 0x3a86ff);
        scene.add(m);
        m.updateMatrixWorld(true);
        box.setFromObject(m).getCenter(mid);
        const d = box.getSize(size).length();
        cam.position.copy(mid).addScaledVector(from, d * 1.85);
        cam.lookAt(mid);
        r.render(scene, cam);
        pics[id] = r.domElement.toDataURL('image/png');
        scene.remove(m);
      }
    } catch (e) { /* no pictures: the list still works with names */ }
    if (r) { r.dispose(); if (r.forceContextLoss) r.forceContextLoss(); }
    return (CW._partPics = pics);
  };

  class Workshop {
    constructor(game) {
      this.game = game;
      this.active = false;
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x141a33);
      this.scene.environment = CW.makeEnv(game.renderer, 0x8fb4ff, 0x3a4a7a, 0x1d2540).texture; // garage-light reflections
      this.scene.fog = new THREE.Fog(0x141a33, 26, 60);
      this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
      this.scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x2a2f45, 0.85));
      // a cool rim light from behind makes the mech's outline stand out against the dark garage
      const rim = new THREE.DirectionalLight(0x8fd8ff, 0.45);
      rim.position.set(-6, 8, 14);
      this.scene.add(rim);
      const dl = new THREE.DirectionalLight(0xffffff, 0.8);
      dl.position.set(8, 16, 6);
      dl.castShadow = true;
      dl.shadow.mapSize.set(1024, 1024);
      Object.assign(dl.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 });
      this.scene.add(dl);

      const gb = CW.GRID;
      const floorY = gb.minY - 0.5;
      // a dark, matte turntable with a thin cyan edge (calm, so the mech is what you look at)
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.4, 0.5, 64), new THREE.MeshLambertMaterial({ color: 0x161d38 }));
      pad.position.y = floorY - 0.25;
      pad.receiveShadow = true;
      this.scene.add(pad);
      const inner = new THREE.Mesh(new THREE.CircleGeometry(6.6, 64).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x1c2445 }));
      inner.position.y = floorY + 0.003;
      inner.receiveShadow = true;
      this.scene.add(inner);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(9.05, 0.035, 6, 96), new THREE.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.45 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = floorY + 0.01;
      this.scene.add(ring);
      const grid = new THREE.GridHelper(9, 9, 0x3a4878, 0x2a3560);
      grid.position.y = floorY + 0.01;
      grid.material.transparent = true;
      grid.material.opacity = 0.7;
      this.scene.add(grid);
      const vol = new THREE.Box3(new THREE.Vector3(gb.minX - 0.5, gb.minY - 0.5, gb.minZ - 0.5), new THREE.Vector3(gb.maxX + 0.5, gb.maxY + 0.5, gb.maxZ + 0.5));
      const volLines = new THREE.Box3Helper(vol, 0x34406a);
      volLines.material.transparent = true;
      volLines.material.opacity = 0.5;
      this.scene.add(volLines);
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1, 3), new THREE.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.6 }));
      arrow.rotation.x = -Math.PI / 2;
      arrow.position.set(0, floorY + 0.05, gb.minZ - 1.6);
      this.scene.add(arrow);
      // mirror plane
      const mp = new THREE.Mesh(
        new THREE.PlaneGeometry(gb.maxZ - gb.minZ + 1, gb.maxY - gb.minY + 1),
        new THREE.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.04, side: THREE.DoubleSide, depthWrite: false })
      );
      mp.rotation.y = Math.PI / 2;
      mp.position.set(0, (gb.maxY + gb.minY) / 2, (gb.maxZ + gb.minZ) / 2);
      this.mirrorPlane = mp;
      this.scene.add(mp);

      this.mechGroup = new THREE.Group();
      this.scene.add(this.mechGroup);
      // ghost previews (real part shape, translucent)
      this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x6cff8a, transparent: true, opacity: 0.45, depthWrite: false });
      this.ghost = new THREE.Group();
      this.ghostMirror = new THREE.Group();
      this.scene.add(this.ghost, this.ghostMirror);
      const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.06, 1.06, 1.06));
      this.hoverBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff }));
      this.hoverBox.visible = false;
      this.scene.add(this.hoverBox);
      this.pickMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      this.pickGeo = new THREE.BoxGeometry(1, 1, 1);
      this.raycaster = new THREE.Raycaster();

      this.orbit = { yaw: -2.35, pitch: 0.42, dist: 13, target: new THREE.Vector3(0, 0.5, 0) };
      this.selected = 'frame';
      this.mirror = true;
      this.mouse = { x: -1, y: -1, down: -1, moved: 0 };
      this.undoStack = [];
      this.redoStack = [];
      this.time = 0;
      this.buildPalette();
      this.buildPaint();
      this.bindUI();
    }

    // ---------------- UI ----------------
    buildPalette() {
      const pal = $('wsPalette');
      pal.innerHTML = '';
      let n = 0;
      for (const cat of CW.CATS) {
        const h = document.createElement('div');
        h.className = 'pal-cat';
        const dom = Object.values(CW.PARTS).find((d) => d.cat === cat && d.domain);
        h.innerHTML = cat + (dom ? ` <span class="dom-dot" style="background:${CW.DOMAINS[dom.domain].color}"></span>` : '');
        pal.appendChild(h);
        for (const [id, d] of Object.entries(CW.PARTS)) {
          if (d.cat !== cat) continue;
          n++;
          const b = document.createElement('button');
          b.className = 'pal-item';
          b.dataset.part = id;
          b.innerHTML = `<span class="key">${n <= 9 ? n : n === 10 ? 0 : ''}</span><img class="pic" alt="" draggable="false"><span class="nm">${d.name}</span><span class="cnt"></span><span class="cost">${d.cost}</span>`;
          b.onclick = () => this.select(id);
          b.onmouseenter = () => this.showInfo(id);
          b.onmouseleave = () => this.showInfo(this.selected);
          pal.appendChild(b);
        }
      }
      this.partKeys = Object.keys(CW.PARTS).filter((k) => k !== 'core');
      this.select('frame');
    }

    buildPaint() {
      const box = $('wsPaint');
      box.innerHTML = '';
      for (const c of this.game.meta ? this.game.meta.paints() : CW.PAINTS) {
        const b = document.createElement('button');
        b.className = 'paint';
        CW.paintSwatch(b, c);
        b.dataset.color = c;
        b.setAttribute('aria-label', 'Paint your mech');
        b.onclick = () => {
          if (!this.bp) return;
          this.pushUndo();
          this.bp.color = c;
          this.changed();
        };
        box.appendChild(b);
      }
    }

    // grey out parts the player hasn't unlocked yet
    refreshLocks() {
      document.querySelectorAll('.pal-item').forEach((b) => {
        const t = b.dataset.part;
        const locked = CW.partLocked(t, this.game);
        b.classList.toggle('locked', locked);
        b.querySelector('.cost').textContent = locked ? `🔒 Lv${CW.PART_LEVEL[t]}` : CW.PARTS[t].cost;
      });
      if (CW.partLocked(this.selected, this.game)) this.select('frame');
    }

    select(id) {
      if (CW.partLocked(id, this.game)) {
        this.game.toast(`${CW.PARTS[id].name} unlocks at level ${CW.PART_LEVEL[id]}`);
        return;
      }
      this.selected = id;
      document.querySelectorAll('.pal-item').forEach((b) => b.classList.toggle('sel', b.dataset.part === id));
      this.showInfo(id);
      this.rebuildGhost();
    }

    showInfo(id) {
      const d = CW.PARTS[id];
      const bits = [`<b>${d.name}</b> · ${d.cost} Bolts · ${d.mass} mass · ${d.hp} HP`];
      if (d.domain) bits.push(`<span class="chip" style="background:${CW.DOMAINS[d.domain].color}">${CW.DOMAINS[d.domain].icon} ${CW.DOMAINS[d.domain].label}</span>`);
      if (d.use) bits.push(`Uses ${d.use} power`);
      if (d.power) bits.push(`+${d.power} power`);
      $('wsInfo').innerHTML = bits.join(' · ') + `<div class="desc">${d.desc}</div>`;
    }

    rebuildGhost() {
      for (const g of [this.ghost, this.ghostMirror]) {
        while (g.children.length) g.remove(g.children[0]);
        const mesh = CW.buildPartMesh(this.selected, (this.bp && this.bp.color) || this.game.playerColor);
        mesh.traverse((o) => { if (o.isMesh) { o.material = this.ghostMat; o.castShadow = false; } });
        g.add(mesh);
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)), new THREE.LineBasicMaterial({ color: 0x6cff8a, transparent: true, opacity: 0.6 }));
        g.add(edge);
        g.userData.edge = edge;
      }
    }

    bindUI() {
      const cv = this.game.renderer.domElement;
      cv.addEventListener('mousemove', (e) => {
        if (!this.active) return;
        if (this.mouse.down >= 0) {
          const dx = e.clientX - this.mouse.x, dy = e.clientY - this.mouse.y;
          this.mouse.moved += Math.abs(dx) + Math.abs(dy);
          if (this.mouse.moved > 5) {
            if (this.mouse.down === 1 || e.shiftKey) this.pan(dx, dy);
            else {
              this.orbit.yaw -= dx * 0.008;
              this.orbit.pitch = Math.max(-0.25, Math.min(1.45, this.orbit.pitch + dy * 0.008));
            }
          }
        }
        this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      });
      cv.addEventListener('mousedown', (e) => {
        if (!this.active) return;
        e.preventDefault();
        this.mouse.down = e.button;
        this.mouse.moved = 0;
        this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      });
      window.addEventListener('mouseup', (e) => {
        if (!this.active || this.mouse.down < 0) return;
        const btn = this.mouse.down;
        this.mouse.down = -1;
        if (this.mouse.moved > 5 || e.target !== cv) return;
        this.mouse.x = e.clientX; this.mouse.y = e.clientY;
        if (btn === 0) this.placeAtHover();
        else if (btn === 2) this.removeAtHover();
      });
      cv.addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); });
      cv.addEventListener('mouseleave', () => { if (this.active) { this.mouse.x = -1; this.mouse.y = -1; } });
      cv.addEventListener('wheel', (e) => {
        if (!this.active) return;
        this.orbit.dist = Math.max(5, Math.min(26, this.orbit.dist + Math.sign(e.deltaY) * 1.2));
      }, { passive: true });
      window.addEventListener('keydown', (e) => {
        if (!this.active || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); this.redo(); return; }
        if (e.code === 'KeyM') this.setMirror(!this.mirror);
        if (e.code === 'KeyQ') this.orbit.yaw += 0.35;
        if (e.code === 'KeyE') this.orbit.yaw -= 0.35;
        if (e.code === 'KeyF') this.resetView();
        if (e.code === 'KeyT' && !this.rush) this.testDrive();
        const k = e.key === '0' ? 10 : parseInt(e.key, 10);
        if (k >= 1 && k <= 10 && this.partKeys[k - 1]) this.select(this.partKeys[k - 1]);
      });

      $('wsMirror').onclick = () => this.setMirror(!this.mirror);
      $('wsUndo').onclick = () => this.undo();
      $('wsRedo').onclick = () => this.redo();
      $('wsView').onclick = () => this.resetView();
      $('wsClear').onclick = () => {
        this.pushUndo();
        this.bp.parts = this.bp.parts.filter((p) => p.t === 'core');
        this.changed();
      };
      $('wsName').oninput = (e) => { this.bp.name = e.target.value.slice(0, 24) || 'Unnamed'; this.persist(); };
      $('wsSave').onclick = () => this.save(false);
      $('wsSaveNew').onclick = () => this.save(true);
      // 🌍 share in the gallery: leave the Workshop with this mech as your current one, pick it in the share box
      $('wsShare').onclick = () => {
        if (!this.validation.ok) return this.game.toast('Fix the red errors first');
        const bp = CW.cloneBp(this.bp);
        this.game.setCurrentBp(bp);
        this.game.showMenu();
        this.game.gallery.open();
        this.game.gallery.shareDialog(bp);
      };
      $('wsCopy').onclick = () => {
        const code = CW.encodeBp(this.bp);
        this.game.openModal('Blueprint code', 'Share this code with friends. They can paste it in their Workshop.', code, null);
      };
      $('wsPaste').onclick = () => {
        this.game.openModal('Paste blueprint code', 'Paste a Cogwild code (starts with CW1:).', '', (txt) => {
          try {
            const bp = CW.decodeBp(txt);
            this.load(bp);
            this.game.toast(`Loaded "${bp.name}"`);
          } catch (err) {
            this.game.toast('Invalid code: ' + err.message);
          }
        });
      };
      $('wsBack').onclick = () => {
        if (this.rush && this.rush.onBack) { const cb = this.rush.onBack; this.rush = null; return cb(); }
        if (this.rush) this.game.showModes();
        else this.game.showMenu();
      };
      $('wsReady').onclick = () => this.ready(false);
      $('wsTest').onclick = () => this.testDrive();
    }

    pan(dx, dy) {
      const k = this.orbit.dist * 0.0018;
      const right = new THREE.Vector3(Math.cos(this.orbit.yaw), 0, -Math.sin(this.orbit.yaw));
      this.orbit.target.addScaledVector(right, -dx * k);
      this.orbit.target.y = Math.max(-2, Math.min(5, this.orbit.target.y + dy * k));
      this.orbit.target.x = Math.max(-5, Math.min(5, this.orbit.target.x));
      this.orbit.target.z = Math.max(-5, Math.min(5, this.orbit.target.z));
    }

    resetView() {
      Object.assign(this.orbit, { yaw: -2.35, pitch: 0.42, dist: 13 });
      this.orbit.target.set(0, 0.5, 0);
    }

    setMirror(v) {
      this.mirror = v;
      $('wsMirror').classList.toggle('on', v);
      $('wsMirror').textContent = 'Mirror: ' + (v ? 'ON' : 'OFF');
      this.mirrorPlane.visible = v;
    }

    // ---------------- lifecycle ----------------
    // the part pictures are made the first time the Workshop opens (not while the game is starting)
    fillPictures() {
      if (this.picsDone) return;
      this.picsDone = true;
      const pics = CW.partPictures();
      for (const b of document.querySelectorAll('#wsPalette .pal-item')) {
        const img = b.querySelector('.pic');
        if (img && pics[b.dataset.part]) img.src = pics[b.dataset.part];
      }
    }

    open(bp, rush) {
      this.fillPictures();
      this.active = true;
      this.rush = rush || null;
      this.undoStack = [];
      this.redoStack = [];
      this.setBlueprint(CW.cloneBp(bp));
      this.setMirror(this.mirror);
      const scratch = !!(rush && rush.fromScratch);
      $('workshopUI').classList.remove('hidden');
      $('wsRush').classList.toggle('hidden', !rush);
      $('wsTest').classList.toggle('hidden', !!rush);
      $('wsBpSection').classList.toggle('hidden', scratch);
      $('wsTitle').textContent = rush ? 'Rush build' : 'Workshop';
      if (rush) {
        this.rushTime = rush.time;
        $('wsRushMode').textContent = rush.modeName;
        $('wsRushNote').textContent = scratch ? 'Build from scratch. Your Workshop mechs are not allowed here!' : '';
      }
      this.renderBlueprintList();
      this.updateUndoButtons();
      this.refreshLocks();
      this.buildPaint();
      this.changed();
    }

    close() {
      this.active = false;
      this.mouse.down = -1;
      $('workshopUI').classList.add('hidden');
    }

    setBlueprint(bp) {
      this.bp = bp;
      if (!this.bp.color) this.bp.color = this.game.playerColor;
      $('wsName').value = bp.name;
      this.rebuildGhost();
      this.changed();
    }

    load(bp) {
      this.pushUndo();
      this.setBlueprint(CW.cloneBp(bp));
    }

    persist() {
      if (!this.rush) this.game.setCurrentBp(this.bp);
    }

    changed() {
      this.bp.parts = CW.connected(this.bp.parts);
      this.rebuildMesh();
      this.updateStats();
      this.persist();
      document.querySelectorAll('.paint').forEach((b) => b.classList.toggle('sel', +b.dataset.color === this.bp.color));
      this.updateUndoButtons();
    }

    // ---------------- undo / redo ----------------
    snapshot() { return JSON.stringify({ parts: this.bp.parts.map(({ t, x, y, z }) => ({ t, x, y, z })), color: this.bp.color, name: this.bp.name }); }
    pushUndo() {
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.redoStack = [];
    }
    restore(s) {
      const d = JSON.parse(s);
      this.bp.parts = d.parts;
      this.bp.color = d.color;
      this.bp.name = d.name;
      $('wsName').value = d.name;
      this.rebuildGhost();
      this.changed();
    }
    undo() {
      if (!this.undoStack.length) return;
      this.redoStack.push(this.snapshot());
      this.restore(this.undoStack.pop());
    }
    redo() {
      if (!this.redoStack.length) return;
      this.undoStack.push(this.snapshot());
      this.restore(this.redoStack.pop());
    }
    updateUndoButtons() {
      $('wsUndo').disabled = !this.undoStack.length;
      $('wsRedo').disabled = !this.redoStack.length;
    }

    rebuildMesh() {
      while (this.mechGroup.children.length) this.mechGroup.remove(this.mechGroup.children[0]);
      this.pickBoxes = [];
      const counts = {};
      for (const p of this.bp.parts) {
        counts[p.t] = (counts[p.t] || 0) + 1;
        const obj = CW.buildPartMesh(p.t, this.bp.color, this.game.profile.finish);
        obj.position.set(p.x, p.y, p.z);
        this.mechGroup.add(obj);
        const pick = new THREE.Mesh(this.pickGeo, this.pickMat);
        pick.position.set(p.x, p.y, p.z);
        pick.userData.cell = p;
        this.mechGroup.add(pick);
        this.pickBoxes.push(pick);
        p._obj = obj;
      }
      this.mechGroup.updateMatrixWorld(true);
      document.querySelectorAll('.pal-item').forEach((b) => {
        const c = counts[b.dataset.part];
        b.querySelector('.cnt').textContent = c ? '×' + c : '';
      });
    }

    // ---------------- building ----------------
    pick() {
      if (this.mouse.x < 0) return null;
      const r = this.game.renderer.domElement.getBoundingClientRect();
      const nx = ((this.mouse.x - r.left) / r.width) * 2 - 1;
      const ny = -((this.mouse.y - r.top) / r.height) * 2 + 1;
      this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
      const hits = this.raycaster.intersectObjects(this.pickBoxes || [], false);
      if (!hits.length) return null;
      const h = hits[0];
      const cell = h.object.userData.cell;
      const n = h.face.normal;
      return { cell, target: { x: cell.x + Math.round(n.x), y: cell.y + Math.round(n.y), z: cell.z + Math.round(n.z) } };
    }

    inBounds(c) {
      const g = CW.GRID;
      return c.x >= g.minX && c.x <= g.maxX && c.y >= g.minY && c.y <= g.maxY && c.z >= g.minZ && c.z <= g.maxZ;
    }
    occupied(c) { return this.bp.parts.some((p) => p.x === c.x && p.y === c.y && p.z === c.z); }
    cost() { return this.bp.parts.reduce((s, p) => s + CW.PARTS[p.t].cost, 0); }
    budget() { return (this.rush && this.rush.budget) || CW.BUDGET; }

    canPlace(c, extraCost) {
      if (!c || !this.inBounds(c) || this.occupied(c)) return false;
      return this.cost() + extraCost <= this.budget();
    }

    // Camera rules: one only, and its view must stay clear
    placeProblem(t, c) {
      const parts = this.bp.parts;
      if (t === 'camera') {
        if (parts.some((p) => p.t === 'camera')) return 'Only one Camera: remove the old one first';
        if (CW.cameraBlocked(parts.concat([{ t, ...c }]))) return 'Camera would be blocked: place it with nothing in front';
      } else {
        const cam = parts.find((p) => p.t === 'camera');
        if (cam && c.x === cam.x && c.y === cam.y && c.z < cam.z) return 'That would block your Camera\'s view';
      }
      return null;
    }

    placeAtHover() {
      const h = this.pick();
      if (!h) return;
      const c = h.target;
      const d = CW.PARTS[this.selected];
      if (!this.inBounds(c)) return this.game.toast('Outside the build area');
      if (this.occupied(c)) return;
      if (this.cost() + d.cost > this.budget()) return this.game.toast('Not enough Bolts!');
      const why = this.placeProblem(this.selected, c);
      if (why) return this.game.toast(why);
      this.pushUndo();
      this.bp.parts.push({ t: this.selected, x: c.x, y: c.y, z: c.z });
      if (this.mirror && c.x !== 0 && !d.unique) {
        const m = { x: -c.x, y: c.y, z: c.z };
        if (this.canPlace(m, d.cost) && !this.placeProblem(this.selected, m)) this.bp.parts.push({ t: this.selected, ...m });
      }
      this.game.audio.click(1);
      this.changed();
    }

    removeAtHover() {
      const h = this.pick();
      if (!h) return;
      if (h.cell.t === 'core') return this.game.toast('The Core can\'t be removed');
      const c = h.cell;
      this.pushUndo();
      const before = this.bp.parts.length;
      this.bp.parts = this.bp.parts.filter((p) => p !== c);
      if (this.mirror && c.x !== 0) this.bp.parts = this.bp.parts.filter((p) => !(p.x === -c.x && p.y === c.y && p.z === c.z && p.t === c.t));
      const after = CW.connected(this.bp.parts).length;
      const lost = this.bp.parts.length - after;
      if (lost > 0) this.game.toast(`${lost} unattached part${lost > 1 ? 's' : ''} fell off`);
      this.game.audio.click(0.6);
      if (before !== this.bp.parts.length) this.changed();
    }

    // ---------------- stats ----------------
    updateStats() {
      const allowed = this.game.allowedDomains();
      const budget = this.budget();
      const v = CW.validate(this.bp.parts, allowed, budget);
      const s = v.s;
      this.validation = v;
      const pct = Math.min(100, (s.cost / budget) * 100);
      $('wsBolts').textContent = `${s.cost} / ${budget}`;
      $('wsBoltBar').style.width = pct + '%';
      $('wsBoltBar').classList.toggle('over', s.cost > budget);
      const rank = CW.RANKS[allowed - 1];
      $('wsRank').innerHTML = `Rank <b>${rank.name}</b>: ${allowed} type${allowed > 1 ? 's' : ''}`;
      const chips = ['land', 'water', 'air'].map((d) => {
        const on = s.domains.has(d);
        const info = CW.DOMAINS[d];
        return `<span class="chip ${on ? '' : 'off'}" style="${on ? 'background:' + info.color : ''}">${info.icon} ${info.label}</span>`;
      });
      $('wsDomains').innerHTML = chips.join('') + `<span class="dom-count ${s.domains.size > allowed ? 'bad' : ''}">${s.domains.size}/${allowed}</span>`;

      const sp = (v) => (v > 0.5 ? Math.round(v * 3.6) + ' km/h' : '—');
      const land = s.drive > 0 || s.thrust > 0 ? `${sp(s.landSpeed)}${s.legs ? ' · climbs cliffs' : s.bigWheels ? ' · rough ground' : s.wheels ? ' · flat ground' : ''}` : 'Can\'t drive';
      let water;
      if (s.floats) water = `Floats · ${sp(s.waterSpeed)}`;
      else if (s.swim > 0) water = `Submarine · ${sp(s.waterSpeed)}`;
      else water = 'Sinks (crawls on the bottom)';
      let air;
      if (s.hovers) air = `Hovers · ${sp(s.airSpeed)}`;
      else if (s.planeFlies) air = `Takes off at ${sp(s.takeoff)}`;
      else if (s.wings || s.rotors) air = 'Too heavy to fly';
      else air = 'Can\'t fly';
      const rows = [
        ['Parts', this.bp.parts.length],
        ['Mass', s.mass.toFixed(1)],
        ['Power', `${s.supply} / ${s.use} <span class="${s.pr < 1 ? 'bad' : 'good'}">(${Math.round(s.pr * 100)}%)</span>`],
        ['Total HP', s.hp],
        ['Shield', s.shield || '—'],
        ['Damage/s', Math.round(s.dps) || '—'],
        ['⛰ Land', land],
        ['🌊 Water', water],
        ['☁ Air', air],
        ['Super', (() => { const sp = CW.SUPERS && CW.SUPERS[CW.superFor(this.bp.parts)]; return sp ? `<span aria-label="${sp.desc}">${sp.icon} ${sp.name}</span>` : '—'; })()],
      ];
      $('wsStats').innerHTML = rows.map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join('');
      $('wsWarn').innerHTML =
        v.errors.map((e) => `<div class="err">✖ ${e}</div>`).join('') + v.warnings.map((w) => `<div class="warn">⚠ ${w}</div>`).join('');
      $('wsReady').disabled = !v.ok;
    }

    // ---------------- blueprints ----------------
    renderBlueprintList() {
      const list = $('wsBpList');
      list.innerHTML = '';
      const allowed = this.game.allowedDomains();
      const mk = (bp, kind, idx) => {
        const s = CW.analyze(bp.parts);
        const row = document.createElement('div');
        row.className = 'bp-row';
        const dots = [...s.domains].map((d) => `<span class="dom-dot" style="background:${CW.DOMAINS[d].color}"></span>`).join('');
        const locked = s.domains.size > allowed;
        row.innerHTML = `<span class="bp-name">${CW.esc(bp.name)}</span><span class="bp-meta">${dots}${locked ? ' 🔒' : ''} ${s.cost}</span>`;
        row.setAttribute('aria-label', bp.name + (bp.desc ? ': ' + bp.desc : ''));
        row.onclick = () => { this.load(bp); this.game.toast(`Loaded "${bp.name}"`); };
        if (kind === 'saved') {
          const del = document.createElement('button');
          del.className = 'bp-del';
          del.textContent = '✕';
          del.setAttribute('aria-label', 'Delete');
          del.onclick = (e) => {
            e.stopPropagation();
            this.game.blueprints.splice(idx, 1);
            this.game.saveBlueprints();
            this.renderBlueprintList();
          };
          row.appendChild(del);
        }
        list.appendChild(row);
      };
      const h1 = document.createElement('div');
      h1.className = 'pal-cat';
      h1.textContent = 'My blueprints';
      list.appendChild(h1);
      if (!this.game.blueprints.length) {
        const e = document.createElement('div');
        e.className = 'bp-empty';
        e.textContent = 'Nothing saved yet.';
        list.appendChild(e);
      }
      this.game.blueprints.forEach((bp, i) => mk(bp, 'saved', i));
      const h2 = document.createElement('div');
      h2.className = 'pal-cat';
      h2.textContent = 'Example mechs';
      list.appendChild(h2);
      CW.PRESETS.forEach((bp) => mk(bp, 'preset'));
    }

    save(asNew) {
      const list = this.game.blueprints;
      const idx = asNew ? -1 : list.findIndex((b) => b.name === this.bp.name);
      const copy = CW.cloneBp(this.bp);
      if (idx >= 0) list[idx] = copy;
      else {
        if (asNew && list.some((b) => b.name === copy.name)) copy.name = (copy.name + ' 2').slice(0, 24);
        list.unshift(copy);
      }
      this.game.saveBlueprints();
      this.renderBlueprintList();
      this.game.toast(`Saved "${copy.name}"`);
    }

    testDrive() {
      if (this.rush) return;
      if (!this.validation.ok) return this.game.toast('Fix the red errors first');
      this.game.startTestDrive(CW.cloneBp(this.bp));
    }

    ready(auto) {
      if (!this.rush) return;
      if (!this.validation.ok) {
        if (auto) this.game.toast('Fix your mech to start!');
        return;
      }
      const bp = CW.cloneBp(this.bp);
      const cam = CW.ensureCamera(bp.parts);
      bp.parts = cam.parts;
      if (cam.moved) this.game.toast('📷 Camera auto-placed at the top middle');
      if (!this.rush.fromScratch) this.game.setCurrentBp(bp);
      const cb = this.rush.onReady;
      this.rush = null;
      this.close();
      cb(bp);
    }

    // ---------------- per frame ----------------
    update(dt) {
      this.time += dt;
      const o = this.orbit;
      const c = this.camera;
      c.position.set(
        o.target.x + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist,
        o.target.y + Math.sin(o.pitch) * o.dist,
        o.target.z + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist
      );
      c.lookAt(o.target);
      for (const p of this.bp.parts) {
        const ud = p._obj && p._obj.userData;
        if (!ud) continue;
        if (p.t === 'rotor') ud.spin.rotation.y += dt * 6;
        if (p.t === 'prop') ud.spin.rotation.z += dt * 5;
        if (p.t === 'wheel') ud.spin.rotation.x -= dt * 1.5;
        if (p.t === 'leg') ud.swing.rotation.x = Math.sin(this.time * 3 + ((p.x + p.z) & 1) * Math.PI) * 0.3;
        if (p.t === 'jet') ud.flame.scale.z = 0.5 + Math.sin(this.time * 20) * 0.1;
      }
      // ghost + hover highlight
      const h = this.mouse.down >= 0 && this.mouse.moved > 5 ? null : this.pick();
      const d = CW.PARTS[this.selected];
      this.ghost.visible = this.ghostMirror.visible = false;
      this.hoverBox.visible = false;
      $('wsHover').textContent = '';
      if (h) {
        const hp = h.cell;
        this.hoverBox.visible = true;
        this.hoverBox.position.set(hp.x, hp.y, hp.z);
        this.hoverBox.material.color.setHex(hp.t === 'core' ? 0xffc43d : 0xffffff);
        $('wsHover').textContent = hp.t === 'core' ? 'Core (can\'t be removed)' : `${CW.PARTS[hp.t].name}: right-click to remove`;
        if (this.inBounds(h.target) && !this.occupied(h.target)) {
          const ok = this.canPlace(h.target, d.cost);
          const col = ok ? 0x6cff8a : 0xff5d5d;
          this.ghostMat.color.setHex(col);
          this.ghost.userData.edge.material.color.setHex(col);
          this.ghostMirror.userData.edge.material.color.setHex(col);
          this.ghost.visible = true;
          this.ghost.position.set(h.target.x, h.target.y, h.target.z);
          if (this.mirror && h.target.x !== 0 && this.canPlace({ x: -h.target.x, y: h.target.y, z: h.target.z }, d.cost * 2)) {
            this.ghostMirror.visible = true;
            this.ghostMirror.position.set(-h.target.x, h.target.y, h.target.z);
          }
        }
      }
      // rush timer
      if (this.rush) {
        this.rushTime -= dt;
        const t = Math.max(0, Math.ceil(this.rushTime));
        $('wsTimer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
        $('wsTimer').classList.toggle('urgent', t <= 10);
        if (this.rushTime <= 0) {
          if (!this.validation.ok) {
            const fixed = CW.ensureCamera(this.bp.parts); // time's up: fix a blocked camera for the player
            if (fixed.moved) { this.bp.parts = fixed.parts; this.changed(); }
          }
          if (this.validation.ok) this.ready(true);
          else if (!this._warned) { this._warned = true; this.game.toast('Time\'s up! Fix your mech to start.'); }
        } else this._warned = false;
      }
    }
  }

  CW.Workshop = Workshop;
})();
