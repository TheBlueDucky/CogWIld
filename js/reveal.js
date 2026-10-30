// Cogwild — rewards you claim in the menus get a big moment (v1.10.1): a full-screen reveal with turning light rays,
// the item popping in, coins counting up and sparks. Tap / click / Space / Enter = next, Esc = skip all.
//
// The Power Cell (after every match, on the results screen): a battery you charge. It jumps up in charge (20%, 40%,
// 60%, 80%… OVERLOAD!), glowing hotter each time, then discharges into your reward. Tapping it pumps it faster; the
// whole thing takes 1-3 s. The server decides how far it charges and what it gives (server/accounts.js cellOpen).
(function () {
  const CW = window.CW;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => CW.esc(String(s));
  const hex = (c) => '#' + (c | 0).toString(16).padStart(6, '0');
  const CELL = [ // charge stages: color, words
    { k: 20, c: '#5ce1ff', t: 'Charged' },
    { k: 40, c: '#7cff4f', t: 'Powered up!' },
    { k: 60, c: '#ffd23f', t: 'High voltage!' },
    { k: 80, c: '#ff9f1c', t: 'Supercharged!' },
    { k: 100, c: '#ff4fd8', t: 'OVERLOAD!' },
  ];
  CW.CELL_STAGES = CELL;

  class Reveal {
    constructor(game) {
      this.game = game;
      this.queue = [];
      this.open = false;
    }
    // a reward from the server ({ coins, got: [{ kind, id }], xp, pts }) as reveal items
    items(r) {
      const out = [];
      for (const g of (r && r.got) || []) {
        const it = CW.ECON.item(g.kind, g.id);
        if (!it) continue;
        const label = { paints: 'paint', trails: 'dash trail', finishes: 'mech finish', wrecks: 'wreck effect', supers: 'super', gadgets: 'gadget', perks: 'perk' }[g.kind] || '';
        const ico = g.kind === 'paints' ? `<span class="rv-swatch" style="background:${hex(it.color)}"></span>` : g.kind === 'trails' ? `<span class="rv-swatch" style="background:linear-gradient(90deg,${it.colors.map(hex).join(',')})"></span>` : esc(it.icon || '🎁');
        out.push({ ico, label: it.name, sub: `New ${label}!`, color: g.kind === 'paints' ? hex(it.color) : '#c77dff', big: true });
      }
      if (r && r.coins) out.push({ ico: '🪙', coins: r.coins, label: `+${r.coins} coins`, color: '#ffd23f' });
      if (r && r.xp) out.push({ ico: '⭐', label: `+${r.xp} XP`, color: '#5ce1ff' });
      if (r && r.pts) out.push({ ico: '🎟', label: `+${r.pts} Cog Pass points`, color: '#7cff4f' });
      return out;
    }
    // show a reward: title (e.g. "Trophy Road"), items (see items()), sub line
    show(title, items, sub) {
      if (!items || !items.length) return;
      this.queue.push({ title, items, sub });
      if (!this.open) this.next();
    }
    el() {
      let el = $('reveal');
      if (!el) {
        el = document.createElement('div');
        el.id = 'reveal';
        el.innerHTML = `<div class="rv-rays"></div><div class="rv-stage"><div class="rv-title"></div><div class="rv-item"><i class="rv-ico"></i><b class="rv-label"></b><small class="rv-sub"></small></div><div class="rv-dots"></div><div class="rv-fx"></div></div><div class="rv-tap">Tap to continue</div>`;
        $('app').appendChild(el);
        el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.tap(); });
        this.keys = (e) => {
          if (!this.open) return;
          if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
          else if (['Space', 'Enter', 'NumpadEnter'].includes(e.code)) { e.preventDefault(); e.stopPropagation(); this.tap(); }
        };
        window.addEventListener('keydown', this.keys, true);
      }
      return el;
    }
    next() {
      const cur = this.queue.shift();
      if (!cur) return this.close();
      this.cur = cur;
      this.i = -1;
      this.open = true;
      const el = this.el();
      el.className = 'show';
      el.querySelector('.rv-title').textContent = cur.title || '';
      this.step();
    }
    step() {
      const cur = this.cur;
      this.i++;
      if (this.i >= cur.items.length) return this.next();
      const it = cur.items[this.i], el = this.el(), g = this.game;
      el.style.setProperty('--rc', it.color || '#5ce1ff');
      el.querySelector('.rv-ico').innerHTML = it.ico;
      el.querySelector('.rv-label').textContent = it.coins ? '+0 coins' : it.label;
      el.querySelector('.rv-sub').textContent = it.sub || (this.i === 0 ? cur.sub || '' : '');
      el.querySelector('.rv-dots').innerHTML = cur.items.length > 1 ? cur.items.map((x, k) => `<i class="${k === this.i ? 'on' : ''}"></i>`).join('') : '';
      const item = el.querySelector('.rv-item');
      item.classList.remove('pop'); void item.offsetWidth; item.classList.add('pop');
      this.sparks(it.big ? 46 : 28, it.color);
      g.audio.fanfare();
      g.buzz && g.buzz([20, 30, 40], 0.2);
      // coins count up
      if (it.coins) {
        const t0 = performance.now(), dur = Math.min(1200, 400 + it.coins * 2), lab = el.querySelector('.rv-label');
        const run = () => {
          const k = Math.min(1, (performance.now() - t0) / dur), n = Math.round(it.coins * (1 - Math.pow(1 - k, 3)));
          lab.textContent = `+${n} coins`;
          if (k < 1 && this.open) requestAnimationFrame(run);
          else if (k >= 1) g.audio.tone(1400, 0.08, 'triangle', 0.12);
        };
        requestAnimationFrame(run);
      }
      this.at = performance.now();
    }
    // little sparks flying out of the middle
    sparks(n, color) {
      const box = this.el().querySelector('.rv-fx');
      box.innerHTML = '';
      for (let k = 0; k < n; k++) {
        const s = document.createElement('i');
        const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 220;
        s.style.cssText = `--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;--d:${0.6 + Math.random() * 0.7}s;background:${Math.random() < 0.5 ? color || '#5ce1ff' : '#fff'}`;
        box.appendChild(s);
      }
    }
    tap() {
      if (this.cell) return this.cellTap();
      if (!this.open || performance.now() - (this.at || 0) < 350) return;
      this.step();
    }
    close() {
      this.open = false;
      this.queue = [];
      this.cell = null;
      const el = $('reveal');
      if (el) el.className = '';
    }

    // ---------------- the Power Cell ----------------
    // res: { lv: 1..5, reward } from the server (or null: no cell to open)
    powerCell(res, onDone) {
      const g = this.game;
      if (this.afterCell) { this.afterCell(); this.afterCell = null; }
      if (!res) { g.toast('⚡ No Power Cell this time'); return; }
      const el = this.el();
      this.open = true;
      this.queue = [];
      el.className = 'show cell';
      el.style.setProperty('--rc', CELL[0].c);
      el.querySelector('.rv-title').textContent = '⚡ POWER CELL';
      el.querySelector('.rv-dots').innerHTML = '';
      el.querySelector('.rv-ico').innerHTML = '<span class="pc"><span class="pc-cap"></span><span class="pc-body"><span class="pc-fill"></span><span class="pc-bolt">⚡</span></span></span>';
      el.querySelector('.rv-label').textContent = '0%';
      el.querySelector('.rv-sub').textContent = 'Tap to pump it up!';
      this.cell = { res, stage: -1, onDone, next: performance.now() + 300 };
      this.cellLoop();
    }
    cellTap() { const c = this.cell; if (c) { c.next = Math.min(c.next, performance.now() + 60); this.game.audio.tone(300 + c.stage * 80, 0.05, 'square', 0.06); } }
    cellLoop() {
      const c = this.cell;
      if (!c || !this.open) return;
      const now = performance.now();
      if (now >= c.next) {
        c.stage++;
        if (c.stage < c.res.lv) this.cellStage(c.stage);
        else return this.cellBurst();
        c.next = now + (c.stage + 1 >= c.res.lv ? 520 : 380); // OVERLOAD (the biggest) still opens in under 3 s
      }
      requestAnimationFrame(() => this.cellLoop());
    }
    cellStage(i) {
      const S = CELL[i], el = this.el(), g = this.game;
      el.style.setProperty('--rc', S.c);
      el.classList.toggle('overload', i === 4);
      el.querySelector('.pc-fill').style.height = S.k + '%';
      el.querySelector('.rv-label').textContent = i === 4 ? 'OVERLOAD!' : S.k + '%';
      el.querySelector('.rv-sub').textContent = S.t;
      const item = el.querySelector('.rv-item');
      item.classList.remove('zap'); void item.offsetWidth; item.classList.add('zap');
      this.sparks(14 + i * 8, S.c);
      g.audio.tone(500 + i * 160, 0.18, 'sawtooth', 0.12, 1.8);
      setTimeout(() => g.audio.tone(900 + i * 200, 0.12, 'square', 0.08), 70);
      g.buzz && g.buzz(15 + i * 10, 0.15);
    }
    cellBurst() {
      const c = this.cell, g = this.game;
      this.cell = null;
      const el = this.el();
      el.classList.add('burst');
      g.audio.boom && g.audio.noise(0.4, 0.4, 2500);
      setTimeout(() => {
        el.classList.remove('burst', 'cell', 'overload');
        const items = this.items(c.res.reward);
        this.cur = { title: `⚡ ${CELL[c.res.lv - 1].t}`, items: items.length ? items : [{ ico: '🪙', label: 'Nothing this time', color: '#8d99ae' }] };
        this.i = -1;
        this.step();
        if (c.onDone) c.onDone();
      }, 380);
    }
  }

  CW.Reveal = Reveal;
})();
