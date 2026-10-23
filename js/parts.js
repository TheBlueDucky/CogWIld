// Cogwild — part definitions, part meshes, presets and stat analysis
(function () {
  const CW = (window.CW = window.CW || {});

  CW.VERSION = 'v1.5';
  // escape text before it goes into innerHTML (mech/player names can come from pasted save codes)
  // "3h 12m" / "5d 4h" / "12m" until something ends
  CW.timeLeft = (ms) => { const m = Math.max(1, Math.ceil(ms / 60000)); return m >= 2880 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
  CW.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  CW.SAVE_VERSION = 2;
  CW.WATER_Y = 0;
  CW.GRAV = 22;
  CW.BUDGET = 300;
  CW.ARENA_HALF = 176;
  CW.CEILING = 110;
  CW.DRAG = { land: 1.55, water: 1.2, air: 0.55 }; // lower = faster top speed
  CW.GRID = { minX: -4, maxX: 4, minY: -2, maxY: 4, minZ: -4, maxZ: 4 };
  CW.WING_LIFT = 0.7;
  CW.ROTOR_LIFT = 10;

  CW.RANKS = [
    { name: 'Mono', domains: 1, level: 1, desc: '1 movement type per mech' },
    { name: 'Hybrid', domains: 2, level: 3, desc: '2 movement types per mech' },
    { name: 'Omni', domains: 3, level: 6, desc: 'All 3 movement types per mech' },
  ];

  CW.DOMAINS = {
    land: { label: 'Land', icon: '⛰', color: '#7bc950' },
    water: { label: 'Water', icon: '🌊', color: '#2fa8ff' },
    air: { label: 'Air', icon: '☁', color: '#b9c8ff' },
  };

  CW.CATS = ['Control', 'Structure', 'Land', 'Water', 'Air', 'Power', 'Weapon', 'Utility', 'Decor'];

  CW.PARTS = {
    core:   { name: 'Core', cat: 'Core', cost: 0, mass: 4, hp: 150, color: 0xffc43d, power: 12, desc: 'The heart of your mech. If it breaks, your mech is wrecked.' },
    camera: { name: 'Camera', cat: 'Control', cost: 0, mass: 0.4, hp: 45, color: 0x111827, unique: true, desc: 'Your eyes: you see the match from here. One per mech, nothing may sit in front of it. If you skip it, it\'s auto-placed on top.' },
    frame:  { name: 'Frame', cat: 'Structure', cost: 4, mass: 1, hp: 35, color: 0x3a86ff, desc: 'Light, cheap building block. Uses your team color.' },
    armor:  { name: 'Armor', cat: 'Structure', cost: 10, mass: 3, hp: 120, color: 0x5c677d, desc: 'Heavy block that soaks up a lot of damage.' },
    wheel:  { name: 'Wheel', cat: 'Land', domain: 'land', cost: 12, mass: 1.5, hp: 35, color: 0x2b2d42, drive: 210, use: 2, desc: 'Fast on flat ground, but can\'t climb steep slopes.' },
    leg:    { name: 'Leg', cat: 'Land', domain: 'land', cost: 20, mass: 2, hp: 45, color: 0xef8354, drive: 175, use: 3, desc: 'Slower, but climbs steep cliffs. Space = jump.' },
    float:  { name: 'Float', cat: 'Water', domain: 'water', cost: 8, mass: 0.8, hp: 25, color: 0xffb703, buoy: 6, desc: 'Keeps your mech on the surface. Add enough or you sink.' },
    prop:   { name: 'Propeller', cat: 'Water', domain: 'water', cost: 16, mass: 1, hp: 28, color: 0x219ebc, swim: 215, use: 3, desc: 'Drives you through water. Space / Shift to dive like a sub.' },
    wing:   { name: 'Wing', cat: 'Air', domain: 'air', cost: 12, mass: 0.8, hp: 25, color: 0xf1f3f5, wingLift: 1, desc: 'Lift at high speed. Combine with a Jet to fly like a plane.' },
    rotor:  { name: 'Rotor', cat: 'Air', domain: 'air', cost: 30, mass: 1.5, hp: 30, color: 0x90be6d, lift: 1, use: 6, desc: 'Vertical lift for hovering. Space = up, Shift = down.' },
    jet:    { name: 'Jet', cat: 'Air', domain: 'air', cost: 26, mass: 1.5, hp: 30, color: 0xf94144, thrust: 300, use: 6, desc: 'Huge forward thrust on land, water or air.' },
    engine: { name: 'Engine', cat: 'Power', cost: 20, mass: 2.5, hp: 45, color: 0x7209b7, power: 22, desc: 'Adds power. If parts need more power than you have, everything slows down.' },
    cannon: { name: 'Cannon', cat: 'Weapon', cost: 24, mass: 2, hp: 40, color: 0x343a40, use: 2, weapon: { rate: 3, speed: 165, dmg: 11, splash: 0, grav: 6, kind: 'shell' }, desc: 'Rapid-fire turret shells.' },
    rocket: { name: 'Rocket Pod', cat: 'Weapon', cost: 36, mass: 2.5, hp: 40, color: 0xd62828, use: 3, weapon: { rate: 0.8, speed: 90, dmg: 34, splash: 4.5, grav: 0, kind: 'rocket' }, desc: 'Slow explosive rockets that blow parts off.' },
    laser:  { name: 'Laser', cat: 'Weapon', cost: 34, mass: 1.5, hp: 35, color: 0x00f5d4, use: 5, weapon: { rate: 10, speed: 0, dmg: 2.6, splash: 0, grav: 0, kind: 'laser', range: 75 }, desc: 'Instant-hit beam. Melts parts at medium range, no travel time.' },
    railgun: { name: 'Railgun', cat: 'Weapon', cost: 42, mass: 2.5, hp: 40, color: 0x48cae4, use: 6, weapon: { rate: 0.45, speed: 340, dmg: 48, splash: 0, grav: 0, kind: 'rail' }, desc: 'Charged long-range slug. Slow to fire, hits like a truck.' },
    flamer: { name: 'Flamethrower', cat: 'Weapon', cost: 28, mass: 1.8, hp: 40, color: 0xff6b1a, use: 4, weapon: { rate: 14, speed: 42, dmg: 2.4, splash: 1.6, grav: -3, kind: 'flame' }, desc: 'Short-range stream of fire that melts everything nearby.' },
    saw: { name: 'Saw Blade', cat: 'Weapon', cost: 16, mass: 1.5, hp: 60, color: 0xced4da, saw: 45, desc: 'Spinning blade that grinds any enemy part it touches.' },
    spikes: { name: 'Spikes', cat: 'Weapon', cost: 10, mass: 1.5, hp: 70, color: 0xadb5bd, ram: 1, desc: 'Ram enemies at speed to smash their parts. Dash into them!' },
    shield: { name: 'Shield', cat: 'Utility', cost: 32, mass: 2, hp: 40, color: 0x4cc9f0, use: 4, shield: 45, desc: 'Adds a regenerating energy shield around your mech.' },
    drone:  { name: 'Repair Drone', cat: 'Utility', cost: 30, mass: 1, hp: 30, color: 0x52e05c, use: 3, heal: 6, desc: 'A little drone that keeps repairing your mech (6 HP/s).' },
    booster:{ name: 'Booster', cat: 'Utility', cost: 18, mass: 1, hp: 30, color: 0xff9f1c, boost: 1, desc: 'Stronger, faster-recharging Dash (Shift). Stack several!' },
    flag:   { name: 'Flag', cat: 'Decor', cost: 1, mass: 0.2, hp: 10, color: 0xffffff, decor: true, desc: 'Show off! Waves in your paint color.' },
    lamp:   { name: 'Lamp', cat: 'Decor', cost: 1, mass: 0.3, hp: 10, color: 0xfff3b0, decor: true, desc: 'A glowing light. Pure style.' },
    horn:   { name: 'Horns', cat: 'Decor', cost: 2, mass: 0.3, hp: 15, color: 0xf8f9fa, decor: true, desc: 'Look scary. Very important.' },
  };
  // cost, movement type and unlock level come from js/economy.js, so the server checks mechs with the same numbers
  for (const [id, [cost, domain]] of Object.entries(CW.ECON.PARTS)) if (CW.PARTS[id]) { CW.PARTS[id].cost = cost; if (domain) CW.PARTS[id].domain = domain; }

  // ---------- Mesh factory ----------
  const geoCache = {};
  const matCache = {};
  const G = (key, fn) => geoCache[key] || (geoCache[key] = fn());

  // ---------- Procedural textures (drawn once on canvases, greyscale so they tint with any color) ----------
  const texCache = {};
  function canvasTex(key, draw, size = 256) {
    if (texCache[key]) return texCache[key];
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    draw(ctx, size);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.userData = { canvas: cv };
    return (texCache[key] = t);
  }
  // the same texture as a picture (for the Shop and Workshop paint swatches)
  const urlCache = {};
  CW.texURL = (key) => urlCache[key] || (urlCache[key] = CW.TEX[key]().userData.canvas.toDataURL('image/jpeg', 0.8));
  // small seeded random so every texture looks the same on every device
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const grain = (ctx, s, amt) => {
    const img = ctx.getImageData(0, 0, s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * amt;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  };
  const rivet = (ctx, x, y, r) => {
    ctx.fillStyle = '#8a8a8a'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, 7); ctx.fill();
  };
  // shared metal details (all greyscale: the part's paint color tints them)
  const brushed = (ctx, s, base, amt, vertical) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < s * 3; i++) {
      const v = 128 + (rnd() - 0.5) * 2 * amt, a = 0.08 + rnd() * 0.12;
      ctx.fillStyle = `rgba(${v | 0},${v | 0},${v | 0},${a})`;
      const p = rnd() * s, len = s * (0.2 + rnd() * 0.8), off = rnd() * s;
      if (vertical) ctx.fillRect(p, off - len / 2, 1 + rnd() * 1.5, len); else ctx.fillRect(off - len / 2, p, len, 1 + rnd() * 1.5);
    }
  };
  const seam = (ctx, x1, y1, x2, y2) => {
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(20,20,20,0.75)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x1 + 3, y1 + 3); ctx.lineTo(x2 + 3, y2 + 3); ctx.stroke();
  };
  const bolt = (ctx, x, y, r) => {
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.arc(x + 1.5, y + 2, r + 1.5, 0, 7); ctx.fill();
    ctx.fillStyle = '#8c8c8c'; ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, 1, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, 7); ctx.fill();
  };
  const scratches = (ctx, s, n, light) => {
    for (let i = 0; i < n; i++) {
      const x = rnd() * s, y = rnd() * s, l = 8 + rnd() * 40, a = rnd() * Math.PI;
      ctx.strokeStyle = light ? `rgba(255,255,255,${0.25 + rnd() * 0.35})` : `rgba(0,0,0,${0.15 + rnd() * 0.2})`;
      ctx.lineWidth = 0.6 + rnd() * 1.2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
  };
  // worn edges: the paint rubs off lighter around the border, grime settles at the bottom
  const wear = (ctx, s) => {
    const e = s * 0.06;
    for (const [x, y, w, h] of [[0, 0, s, e], [0, s - e, s, e], [0, 0, e, s], [s - e, 0, e, s]]) {
      for (let i = 0; i < 60; i++) { ctx.fillStyle = `rgba(255,255,255,${0.1 + rnd() * 0.25})`; ctx.fillRect(x + rnd() * w, y + rnd() * h, 2 + rnd() * 6, 1 + rnd() * 3); }
    }
    const g = ctx.createLinearGradient(0, s * 0.55, 0, s);
    g.addColorStop(0, 'rgba(40,30,20,0)'); g.addColorStop(1, 'rgba(40,30,20,0.28)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  };
  CW.TEX = {
    // painted metal: brushed grain, 2 recessed panels, hex bolts, worn edges, scratches, a stencil mark
    panel: () => canvasTex('panel', (ctx, s) => {
      brushed(ctx, s, '#d6d6d6', 40, false);
      const sh = ctx.createLinearGradient(0, 0, s, s); sh.addColorStop(0, 'rgba(255,255,255,0.2)'); sh.addColorStop(1, 'rgba(0,0,0,0.16)');
      ctx.fillStyle = sh; ctx.fillRect(0, 0, s, s);
      const m = s * 0.07;
      seam(ctx, m, m, s - m, m); seam(ctx, m, s - m, s - m, s - m); seam(ctx, m, m, m, s - m); seam(ctx, s - m, m, s - m, s - m);
      seam(ctx, s / 2, m, s / 2, s - m);
      for (const [x, y] of [[m * 2, m * 2], [s - m * 2, m * 2], [m * 2, s - m * 2], [s - m * 2, s - m * 2], [s / 2 - m, s / 2], [s / 2 + m, s / 2]]) bolt(ctx, x, y, s * 0.022);
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.font = `bold ${s * 0.07}px monospace`; ctx.fillText('CW-07', s * 0.6, s * 0.86);
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(s * 0.14, s * 0.78, s * 0.22, s * 0.035); ctx.fillRect(s * 0.14, s * 0.83, s * 0.14, s * 0.025);
      wear(ctx, s);
      scratches(ctx, s, 40, true);
      scratches(ctx, s, 16, false);
      grain(ctx, s, 14);
    }, 512),
    // armor: diamond tread plate inside a heavy bolted rim
    plate: () => canvasTex('plate', (ctx, s) => {
      brushed(ctx, s, '#c4c4c4', 30, true);
      const d = s / 14;
      for (let y = 0; y < s + d; y += d) for (let x = 0; x < s + d; x += d) {
        const ox = (Math.round(y / d) % 2) * d / 2, a = ((Math.round(x / d) + Math.round(y / d)) % 2) ? 0.6 : -0.6;
        ctx.save(); ctx.translate(x + ox, y); ctx.rotate(a);
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(-d * 0.32, -d * 0.09, d * 0.64, d * 0.12);
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-d * 0.32, d * 0.03, d * 0.64, d * 0.08);
        ctx.restore();
      }
      const r = s * 0.075;
      ctx.fillStyle = 'rgba(80,80,80,0.75)'; ctx.fillRect(0, 0, s, r); ctx.fillRect(0, s - r, s, r); ctx.fillRect(0, 0, r, s); ctx.fillRect(s - r, 0, r, s);
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(r, r, s - 2 * r, 4); ctx.fillRect(r, r, 4, s - 2 * r);
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(r, s - r - 4, s - 2 * r, 4); ctx.fillRect(s - r - 4, r, 4, s - 2 * r);
      for (let i = r * 1.6; i < s - r; i += s / 7) { bolt(ctx, i, r / 2, s * 0.018); bolt(ctx, i, s - r / 2, s * 0.018); bolt(ctx, r / 2, i, s * 0.018); bolt(ctx, s - r / 2, i, s * 0.018); }
      wear(ctx, s);
      scratches(ctx, s, 60, true);
      grain(ctx, s, 18);
    }, 512),
    // weapons and engines: dark machined gunmetal with vents and a warning band
    gunmetal: () => canvasTex('gunmetal', (ctx, s) => {
      brushed(ctx, s, '#9c9c9c', 55, true);
      const m = s * 0.08;
      seam(ctx, m, s * 0.3, s - m, s * 0.3); seam(ctx, m, s * 0.7, s - m, s * 0.7);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      for (let i = 0; i < 6; i++) ctx.fillRect(s * 0.18 + i * s * 0.11, s * 0.4, s * 0.05, s * 0.2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 6; i++) ctx.fillRect(s * 0.18 + i * s * 0.11, s * 0.4, s * 0.05, s * 0.015);
      for (let i = -s; i < s * 2; i += s / 8) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.moveTo(i, s * 0.08); ctx.lineTo(i + s / 16, s * 0.08); ctx.lineTo(i + s / 16 - s * 0.1, s * 0.18); ctx.lineTo(i - s * 0.1, s * 0.18); ctx.fill(); }
      for (const [x, y] of [[m, m], [s - m, m], [m, s - m], [s - m, s - m]]) bolt(ctx, x, y, s * 0.02);
      wear(ctx, s);
      scratches(ctx, s, 50, true);
      grain(ctx, s, 16);
    }, 512),
    // wings, propellers and rotors: carbon-fiber weave
    carbon: () => canvasTex('carbon', (ctx, s) => {
      ctx.fillStyle = '#9a9a9a'; ctx.fillRect(0, 0, s, s);
      const c = s / 32;
      for (let y = 0; y < s; y += c) for (let x = 0; x < s; x += c) {
        const odd = (Math.round(x / c) + Math.round(y / c)) % 2;
        const g = odd ? ctx.createLinearGradient(x, y, x + c, y) : ctx.createLinearGradient(x, y, x, y + c);
        g.addColorStop(0, '#6e6e6e'); g.addColorStop(0.5, '#e4e4e4'); g.addColorStop(1, '#6e6e6e');
        ctx.fillStyle = g; ctx.fillRect(x + 0.5, y + 0.5, c - 1, c - 1);
      }
      const sh = ctx.createLinearGradient(0, 0, s, s); sh.addColorStop(0, 'rgba(255,255,255,0.18)'); sh.addColorStop(1, 'rgba(0,0,0,0.12)');
      ctx.fillStyle = sh; ctx.fillRect(0, 0, s, s);
      seam(ctx, s * 0.05, s * 0.05, s * 0.95, s * 0.05);
      scratches(ctx, s, 20, true);
    }, 512),
    // rubber tire tread (wraps around the cylinder)
    tread: () => canvasTex('tread', (ctx, s) => {
      ctx.fillStyle = '#5a5a5a'; ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#2a2a2a';
      for (let i = 0; i < s; i += 16) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 8, s / 2); ctx.lineTo(i, s); ctx.lineTo(i + 5, s); ctx.lineTo(i + 13, s / 2); ctx.lineTo(i + 5, 0); ctx.fill(); }
      grain(ctx, s, 20);
    }),
    // diagonal hazard stripes
    hazard: () => canvasTex('hazard', (ctx, s) => {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#3a3a3a';
      for (let i = -s; i < s * 2; i += 64) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 32, 0); ctx.lineTo(i + 32 - s, s); ctx.lineTo(i - s, s); ctx.fill(); }
      ctx.strokeStyle = '#555'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, s - 8, s - 8);
      grain(ctx, s, 16);
    }),
    // engine / vent grille
    grille: () => canvasTex('grille', (ctx, s) => {
      ctx.fillStyle = '#d8d8d8'; ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#4a4a4a';
      for (let y = 40; y < s - 40; y += 18) ctx.fillRect(36, y, s - 72, 9);
      ctx.strokeStyle = '#8a8a8a'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, s - 6, s - 6);
      for (const [x, y] of [[18, 18], [s - 18, 18], [18, s - 18], [s - 18, s - 18]]) rivet(ctx, x, y, 6);
      grain(ctx, s, 18);
    }),
    // wooden planks (chests)
    wood: () => canvasTex('wood', (ctx, s) => {
      ctx.fillStyle = '#c9c9c9'; ctx.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += 64) {
        ctx.fillStyle = y % 128 ? '#d8d8d8' : '#bdbdbd'; ctx.fillRect(0, y + 2, s, 60);
        ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
        for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, y + 8 + i * 9 + Math.random() * 4); ctx.bezierCurveTo(s * 0.3, y + 6 + i * 9, s * 0.6, y + 12 + i * 9, s, y + 8 + i * 9); ctx.stroke(); }
        ctx.fillStyle = '#6a6a6a'; ctx.fillRect(0, y, s, 3);
      }
      grain(ctx, s, 22);
    }),
    // terrain detail noise (tiled over the ground)
    ground: () => canvasTex('ground', (ctx, s) => {
      ctx.fillStyle = '#d9d9d9'; ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 2600; i++) {
        const v = 150 + Math.random() * 105;
        ctx.fillStyle = `rgba(${v},${v},${v},0.55)`;
        ctx.beginPath(); ctx.arc(Math.random() * s, Math.random() * s, 1 + Math.random() * 4, 0, 7); ctx.fill();
      }
      grain(ctx, s, 30);
    }),
  };

  function M(color, extra, tex) {
    const k = color + '|' + (extra ? JSON.stringify(extra) : '') + '|' + (tex || '');
    if (!matCache[k]) {
      const opts = Object.assign({ color, roughness: tex ? 0.48 : 0.55, metalness: tex ? 0.45 : 0.1 }, extra || {});
      if (tex) { opts.map = CW.TEX[tex](); opts.bumpMap = opts.map; opts.bumpScale = 0.025; }
      matCache[k] = new THREE.MeshStandardMaterial(opts);
    }
    return matCache[k];
  }
  function MB(color, extra) {
    const k = 'b' + color + '|' + (extra ? JSON.stringify(extra) : '');
    if (!matCache[k]) matCache[k] = new THREE.MeshBasicMaterial(Object.assign({ color }, extra || {}));
    return matCache[k];
  }
  function add(parent, geo, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  const box = (w, h, d) => G(`b${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d));
  const cyl = (rt, rb, h, s = 12) => G(`c${rt}_${rb}_${h}_${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
  const sph = (r, ws = 12, hs = 10) => G(`s${r}_${ws}_${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
  CW.shade = function (hex, l) {
    const c = new THREE.Color(hex);
    c.offsetHSL(0, 0, l);
    return c.getHex();
  };
  CW.mat = M;
  CW.matBasic = MB;

  CW.buildPartMesh = function (t, team) {
    const g = new THREE.Group();
    const ud = g.userData;
    // inside part models every material gets a metal finish unless a part picks another:
    // weapons/engines are gunmetal, wings/props/rotors carbon fiber, armor tread plate, the rest painted panels
    const finish = { cannon: 'gunmetal', rocket: 'gunmetal', laser: 'gunmetal', railgun: 'gunmetal', flamer: 'gunmetal', saw: 'gunmetal', jet: 'gunmetal', booster: 'gunmetal', engine: 'gunmetal', spikes: 'gunmetal', wing: 'carbon', prop: 'carbon', rotor: 'carbon', armor: 'plate' }[t] || 'panel';
    const M = (color, extra, tex) => CW.mat(color, extra, tex || finish);
    switch (t) {
      case 'core': {
        add(g, box(0.92, 0.92, 0.92), M(0xffc43d, null, 'hazard'));
        add(g, box(0.96, 0.2, 0.96), M(team), 0, 0.25, 0);
        add(g, sph(0.24), M(0x7df9ff, { emissive: 0x2a9bb0 }), 0, 0, -0.42);
        add(g, cyl(0.04, 0.04, 0.5, 6), M(0x333333), 0.25, 0.7, 0.25);
        add(g, sph(0.09, 8, 6), M(0xff4d6d, { emissive: 0xaa0022 }), 0.25, 0.97, 0.25);
        break;
      }
      case 'frame':
        add(g, box(0.96, 0.96, 0.96), M(team));
        add(g, box(0.98, 0.12, 0.98), M(CW.shade(team, -0.15)), 0, -0.35, 0);
        break;
      case 'armor':
        add(g, box(1, 1, 1), M(CW.shade(team, -0.22), { metalness: 0.55, roughness: 0.45 }, 'plate'));
        add(g, box(1.03, 0.22, 1.03), M(0xb0b7c3), 0, 0.22, 0);
        add(g, box(1.03, 0.08, 1.03), M(0x6c757d), 0, -0.3, 0);
        break;
      case 'wheel': {
        const spin = new THREE.Group();
        g.add(spin);
        add(spin, cyl(0.48, 0.48, 0.4, 18), M(0x9a9a9a, { roughness: 0.9, metalness: 0 }, 'tread')).rotation.z = Math.PI / 2;
        add(spin, cyl(0.22, 0.22, 0.44, 10), M(0xd9d9d9)).rotation.z = Math.PI / 2;
        add(spin, box(0.42, 0.78, 0.12), M(0xffc43d));
        ud.spin = spin;
        break;
      }
      case 'leg': {
        add(g, box(0.6, 0.28, 0.6), M(team), 0, 0.33, 0);
        add(g, sph(0.24), M(0x555b6e), 0, 0.2, 0);
        const swing = new THREE.Group();
        swing.position.y = 0.2;
        g.add(swing);
        add(swing, box(0.26, 0.55, 0.26), M(0xef8354), 0, -0.3, 0);
        add(swing, box(0.5, 0.18, 0.62), M(0x3d405b), 0, -0.6, -0.08);
        ud.swing = swing;
        break;
      }
      case 'float': {
        const f = add(g, sph(0.5, 16, 12), M(0xffb703));
        f.scale.set(0.95, 0.72, 1.05);
        add(g, cyl(0.49, 0.49, 0.12, 16), M(0xffffff));
        break;
      }
      case 'prop': {
        add(g, cyl(0.3, 0.36, 0.6, 12), M(0x219ebc)).rotation.x = Math.PI / 2;
        const spin = new THREE.Group();
        spin.position.z = 0.38;
        g.add(spin);
        add(spin, sph(0.12, 8, 6), M(0x023047));
        for (let i = 0; i < 3; i++) {
          const piv = new THREE.Group();
          piv.rotation.z = (i * Math.PI * 2) / 3;
          spin.add(piv);
          add(piv, box(0.16, 0.6, 0.04), M(0xffd166), 0, 0.3, 0);
        }
        ud.spin = spin;
        break;
      }
      case 'wing':
        add(g, box(1, 0.1, 0.95), M(0xf1f3f5));
        add(g, box(1.01, 0.12, 0.22), M(team), 0, 0, 0.34);
        add(g, box(0.1, 0.13, 0.95), M(0xced4da), 0, 0, 0);
        break;
      case 'rotor': {
        add(g, box(0.62, 0.32, 0.62), M(0x90be6d), 0, -0.25, 0);
        add(g, cyl(0.07, 0.07, 0.55, 6), M(0x444444), 0, 0.05, 0);
        const spin = new THREE.Group();
        spin.position.y = 0.33;
        g.add(spin);
        add(spin, box(1.9, 0.05, 0.2), M(0xdee2e6));
        add(spin, box(0.2, 0.05, 1.9), M(0xdee2e6));
        add(spin, cyl(0.12, 0.12, 0.1, 8), M(0xf94144));
        ud.spin = spin;
        // motion-blur disc that fades in as the blades spin up
        const blur = new THREE.Mesh(G('rblur', () => new THREE.CircleGeometry(0.98, 28).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: 0xdee2e6, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
        blur.position.y = 0.33;
        g.add(blur);
        ud.blur = blur;
        break;
      }
      case 'jet': {
        add(g, cyl(0.34, 0.42, 0.9, 14), M(0xf94144)).rotation.x = Math.PI / 2;
        add(g, cyl(0.3, 0.25, 0.25, 14), M(0x343a40), 0, 0, 0.52).rotation.x = Math.PI / 2;
        add(g, cyl(0.22, 0.22, 0.05, 12), M(0x111111), 0, 0, -0.46).rotation.x = Math.PI / 2;
        const flame = new THREE.Group();
        flame.position.z = 0.62;
        g.add(flame);
        const cone = new THREE.Mesh(
          G('flame', () => new THREE.ConeGeometry(0.24, 1.2, 10)),
          MB(0xffa53a, { transparent: true, opacity: 0.85, depthWrite: false })
        );
        cone.rotation.x = -Math.PI / 2;
        cone.position.z = 0.6;
        flame.add(cone);
        flame.scale.z = 0.2;
        ud.flame = flame;
        break;
      }
      case 'engine':
        add(g, box(0.86, 0.78, 0.86), M(0x8a2be2, null, 'grille'));
        add(g, box(0.9, 0.2, 0.9), M(0x3a0ca3), 0, -0.3, 0);
        add(g, cyl(0.08, 0.1, 0.5, 8), M(0x9d9d9d), 0.22, 0.55, 0.2);
        add(g, cyl(0.08, 0.1, 0.5, 8), M(0x9d9d9d), -0.22, 0.55, 0.2);
        add(g, box(0.5, 0.25, 0.05), M(0xff5cf0, { emissive: 0xc000b0 }), 0, 0.05, -0.44);
        break;
      case 'cannon': {
        add(g, box(0.72, 0.45, 0.72), M(0x495057), 0, -0.25, 0);
        const aim = new THREE.Group();
        aim.position.y = 0.12;
        g.add(aim);
        add(aim, sph(0.27, 12, 10), M(team));
        add(aim, cyl(0.1, 0.13, 1.1, 10), M(0x343a40), 0, 0, 0.5).rotation.x = Math.PI / 2;
        add(aim, cyl(0.14, 0.14, 0.15, 10), M(0x212529), 0, 0, 1.0).rotation.x = Math.PI / 2;
        aim.rotation.y = Math.PI;
        ud.aim = aim;
        ud.muzzle = 1.1;
        break;
      }
      case 'rocket': {
        add(g, box(0.62, 0.4, 0.62), M(0x495057), 0, -0.28, 0);
        const aim = new THREE.Group();
        aim.position.y = 0.12;
        g.add(aim);
        add(aim, box(0.72, 0.55, 0.75), M(0xd62828));
        for (const sx of [-0.18, 0.18])
          for (const sy of [-0.13, 0.13])
            add(aim, cyl(0.11, 0.11, 0.1, 8), M(0x111111), sx, sy, 0.38).rotation.x = Math.PI / 2;
        aim.rotation.y = Math.PI;
        ud.aim = aim;
        ud.muzzle = 0.6;
        break;
      }
      case 'camera': {
        add(g, box(0.3, 0.3, 0.3), M(0x495057), 0, -0.3, 0);
        add(g, box(0.62, 0.44, 0.6), M(0x111827), 0, 0.05, 0);
        add(g, box(0.64, 0.12, 0.62), M(team), 0, 0.3, 0);
        add(g, cyl(0.2, 0.24, 0.22, 16), M(0x6ee7ff, { emissive: 0x0b7a8c }), 0, 0.05, -0.38).rotation.x = Math.PI / 2;
        add(g, cyl(0.12, 0.12, 0.05, 12), M(0x0a0a0a), 0, 0.05, -0.5).rotation.x = Math.PI / 2;
        add(g, sph(0.06, 8, 6), M(0xff2d55, { emissive: 0xcc0033 }), 0.22, 0.2, -0.3);
        break;
      }
      case 'laser': {
        add(g, box(0.64, 0.4, 0.64), M(0x2b2d42), 0, -0.28, 0);
        const aim = new THREE.Group();
        aim.position.y = 0.1;
        g.add(aim);
        add(aim, sph(0.25, 12, 10), M(team));
        add(aim, cyl(0.08, 0.16, 0.9, 10), M(0xdee2e6), 0, 0, 0.4).rotation.x = Math.PI / 2;
        add(aim, cyl(0.1, 0.1, 0.12, 10), M(0x00f5d4, { emissive: 0x00a896 }), 0, 0, 0.88).rotation.x = Math.PI / 2;
        aim.rotation.y = Math.PI;
        ud.aim = aim;
        ud.muzzle = 0.95;
        break;
      }
      case 'railgun': {
        add(g, box(0.66, 0.4, 0.66), M(0x2b2d42), 0, -0.28, 0);
        const aim = new THREE.Group();
        aim.position.y = 0.12;
        g.add(aim);
        add(aim, box(0.36, 0.34, 0.8), M(team), 0, 0, 0.1);
        add(aim, box(0.08, 0.12, 1.7), M(0xdee2e6, { metalness: 0.8, roughness: 0.25 }), -0.1, 0, 0.75);
        add(aim, box(0.08, 0.12, 1.7), M(0xdee2e6, { metalness: 0.8, roughness: 0.25 }), 0.1, 0, 0.75);
        for (const z of [0.5, 0.9, 1.3]) add(aim, box(0.34, 0.06, 0.06), M(0x48cae4, { emissive: 0x1b7fa0 }), 0, 0.09, z);
        aim.rotation.y = Math.PI;
        ud.aim = aim;
        ud.muzzle = 1.7;
        break;
      }
      case 'flamer': {
        add(g, box(0.62, 0.4, 0.62), M(0x343a40), 0, -0.28, 0);
        const aim = new THREE.Group();
        aim.position.y = 0.12;
        g.add(aim);
        add(aim, cyl(0.2, 0.2, 0.62, 12), M(0xff6b1a), -0.16, 0.02, 0.05).rotation.x = Math.PI / 2;
        add(aim, cyl(0.2, 0.2, 0.62, 12), M(0xff6b1a), 0.16, 0.02, 0.05).rotation.x = Math.PI / 2;
        add(aim, cyl(0.08, 0.14, 0.7, 10), M(0x6c757d, { metalness: 0.8 }), 0, -0.05, 0.55).rotation.x = Math.PI / 2;
        add(aim, sph(0.07, 8, 6), MB(0x4cc9f0), 0, -0.05, 0.92);
        aim.rotation.y = Math.PI;
        ud.aim = aim;
        ud.muzzle = 0.95;
        break;
      }
      case 'saw': {
        add(g, box(0.5, 0.6, 0.5), M(0x495057), 0, 0, 0.1);
        const spin = new THREE.Group();
        spin.position.set(0, 0, -0.35);
        g.add(spin);
        const blade = add(spin, cyl(0.62, 0.62, 0.06, 24), M(0xdee2e6, { metalness: 0.9, roughness: 0.2 }));
        blade.rotation.z = Math.PI / 2;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const tooth = add(spin, box(0.08, 0.16, 0.12), M(0xadb5bd, { metalness: 0.9 }), 0, Math.cos(a) * 0.66, Math.sin(a) * 0.66);
          tooth.rotation.x = a;
        }
        add(spin, cyl(0.14, 0.14, 0.12, 10), M(0xf94144)).rotation.z = Math.PI / 2;
        ud.saw = spin;
        break;
      }
      case 'drone': {
        add(g, box(0.7, 0.2, 0.7), M(0x2b2d42), 0, -0.4, 0);
        add(g, cyl(0.25, 0.3, 0.1, 12), MB(0x52e05c), 0, -0.27, 0);
        const d = new THREE.Group();
        d.position.y = 0.3;
        g.add(d);
        add(d, sph(0.22, 12, 10), M(0xf1f3f5));
        add(d, sph(0.1, 8, 6), MB(0x52e05c), 0, 0, -0.18);
        for (const sx of [-0.32, 0.32]) add(d, box(0.3, 0.03, 0.08), M(0x6c757d), sx, 0.12, 0);
        ud.drone = d;
        break;
      }
      case 'spikes': {
        add(g, box(0.8, 0.8, 0.8), M(0x6c757d));
        const cone = G('spike', () => new THREE.ConeGeometry(0.16, 0.5, 6));
        const dirs = [[0, 1, 0, 0, 0], [0, -1, 0, Math.PI, 0], [1, 0, 0, 0, -Math.PI / 2], [-1, 0, 0, 0, Math.PI / 2], [0, 0, 1, Math.PI / 2, 0], [0, 0, -1, -Math.PI / 2, 0]];
        for (const [x, y, z, rx, rz] of dirs)
          for (const o of [-0.2, 0.2]) {
            const s = add(g, cone, M(0xdee2e6), x * 0.55 + (x ? 0 : o), y * 0.55 + (y || !x ? 0 : o), z * 0.55 + (z || x ? 0 : o));
            s.rotation.set(rx, 0, rz);
          }
        break;
      }
      case 'booster': {
        add(g, box(0.7, 0.7, 0.5), M(0x343a40), 0, 0, -0.1);
        add(g, cyl(0.3, 0.38, 0.5, 14), M(0xff9f1c), 0, 0, 0.3).rotation.x = Math.PI / 2;
        const flame = new THREE.Group();
        flame.position.z = 0.55;
        g.add(flame);
        const cone = new THREE.Mesh(G('bflame', () => new THREE.ConeGeometry(0.28, 1.4, 10)), MB(0x8be9ff, { transparent: true, opacity: 0.9, depthWrite: false }));
        cone.rotation.x = -Math.PI / 2;
        cone.position.z = 0.7;
        flame.add(cone);
        flame.scale.setScalar(0.01);
        ud.boost = flame;
        break;
      }
      case 'flag': {
        add(g, box(0.4, 0.15, 0.4), M(0x495057), 0, -0.42, 0);
        add(g, cyl(0.04, 0.04, 1.6, 6), M(0xced4da), 0, 0.3, 0);
        const fl = new THREE.Group();
        fl.position.set(0, 0.85, 0);
        g.add(fl);
        const cloth = add(fl, box(0.04, 0.45, 0.75), M(team), 0, 0, 0.38);
        cloth.castShadow = false;
        ud.flag = fl;
        break;
      }
      case 'lamp':
        add(g, box(0.4, 0.15, 0.4), M(0x495057), 0, -0.42, 0);
        add(g, cyl(0.05, 0.05, 0.6, 6), M(0x6c757d), 0, -0.1, 0);
        add(g, sph(0.24, 12, 10), MB(0xfff3b0), 0, 0.3, 0);
        add(g, cyl(0.28, 0.2, 0.1, 10), M(0x343a40), 0, 0.5, 0);
        break;
      case 'horn': {
        add(g, box(0.7, 0.2, 0.5), M(0x495057), 0, -0.4, 0);
        const hornGeo = G('horn', () => new THREE.ConeGeometry(0.13, 0.75, 8));
        for (const sx of [-1, 1]) {
          const h = add(g, hornGeo, M(0xf8f9fa), sx * 0.25, 0, 0);
          h.rotation.z = -sx * 0.5;
        }
        break;
      }
      case 'shield':
        add(g, box(0.82, 0.4, 0.82), M(0x0f4c75), 0, -0.25, 0);
        add(
          g,
          G('dome', () => new THREE.SphereGeometry(0.4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)),
          M(0x4cc9f0, { emissive: 0x1b7fa0 }),
          0, -0.05, 0
        );
        break;
    }
    return g;
  };

  // ---------- Analysis ----------
  CW.analyze = function (parts) {
    const s = {
      cost: 0, mass: 0, supply: 0, use: 0, count: {}, drive: 0, swim: 0, thrust: 0,
      rotors: 0, wings: 0, buoy: 0, shield: 0, hp: 0, dps: 0, domains: new Set(), minY: 0, weapons: 0,
    };
    let minY = Infinity;
    for (const p of parts) {
      const d = CW.PARTS[p.t];
      s.cost += d.cost;
      s.mass += d.mass;
      s.supply += d.power || 0;
      s.use += d.use || 0;
      s.count[p.t] = (s.count[p.t] || 0) + 1;
      s.hp += d.hp;
      if (d.domain) s.domains.add(d.domain);
      if (d.drive) s.drive += d.drive;
      if (d.swim) s.swim += d.swim;
      if (d.thrust) s.thrust += d.thrust;
      if (d.lift) s.rotors++;
      if (d.wingLift) s.wings++;
      if (d.buoy) s.buoy += d.buoy;
      if (d.shield) s.shield += d.shield;
      if (d.weapon) { s.dps += d.weapon.rate * d.weapon.dmg; s.weapons++; }
      if (p.y < minY) minY = p.y;
    }
    s.minY = minY === Infinity ? 0 : minY;
    s.legs = s.count.leg || 0;
    s.wheels = s.count.wheel || 0;
    s.boosters = s.count.booster || 0;
    s.spikes = s.count.spikes || 0;
    s.saws = s.count.saw || 0;
    s.heal = (s.count.drone || 0) * 6;
    if (s.saws) { s.dps += s.saws * 45 * 0.5; s.weapons += s.saws; } // melee counts (half, it needs contact)
    s.dashCd = Math.max(1.4, 4.5 - s.boosters * 0.7);
    s.dashPower = 21 + s.boosters * 7;
    s.pr = s.use > 0 ? Math.min(1, s.supply / s.use) : 1;
    s.dps *= 0.4 + 0.6 * s.pr;
    s.landSpeed = ((s.drive + s.thrust) * s.pr) / (s.mass * CW.DRAG.land);
    s.floats = s.buoy + 0.35 * s.mass >= s.mass;
    s.waterSpeed = ((s.swim + s.drive * 0.08 + s.thrust * 0.35) * s.pr) / (s.mass * CW.DRAG.water);
    s.hoverLift = s.rotors * CW.ROTOR_LIFT * s.pr;
    s.hovers = s.rotors > 0 && s.hoverLift >= s.mass;
    s.takeoff = s.wings > 0 ? 8 + Math.max(0, s.mass - s.hoverLift) / (s.wings * CW.WING_LIFT) : Infinity;
    s.planeFlies = s.wings > 0 && s.thrust > 0 && Math.max(s.landSpeed, s.floats ? s.waterSpeed : 0) >= s.takeoff;
    s.canFly = s.hovers || s.planeFlies;
    s.airSpeed = ((s.rotors * 45 + s.thrust) * s.pr) / (s.mass * CW.DRAG.air);
    return s;
  };

  CW.validate = function (parts, allowedDomains, budget) {
    budget = budget || CW.BUDGET;
    const s = CW.analyze(parts);
    const errors = [];
    const warnings = [];
    if (!parts.some((p) => p.t === 'core')) errors.push('Your mech needs a Core.');
    if (s.cost > budget) errors.push(`Over budget: ${s.cost}/${budget} Bolts.`);
    if (s.domains.size > allowedDomains)
      errors.push(`Too many movement types (${s.domains.size}). Your rank allows ${allowedDomains}.`);
    const cams = parts.filter((p) => p.t === 'camera');
    if (cams.length > 1) errors.push('Only one Camera allowed.');
    if (!cams.length) warnings.push('No Camera yet: one will be auto-placed at the top middle.');
    else if (CW.cameraBlocked(parts)) errors.push('Something is in front of your Camera, blocking the view.');
    if (s.weapons === 0 && s.spikes === 0) warnings.push('No weapons: you can only run.');
    if (s.domains.size === 0) warnings.push('No movement parts: your mech can\'t move.');
    if (s.pr < 0.7) warnings.push(`Low power (${Math.round(s.pr * 100)}%): add an Engine.`);
    if (s.wings > 0 && s.thrust === 0 && s.rotors === 0) warnings.push('Wings need a Jet (or Rotors) to fly.');
    if (s.domains.has('water') && !s.floats && s.swim === 0) warnings.push('Floats too weak: this mech sinks.');
    return { s, errors, warnings, ok: errors.length === 0 };
  };

  // ---------- Camera rules ----------
  // Blocked = any part directly in front of the lens (same column, further forward = smaller z)
  CW.cameraBlocked = function (parts, cam) {
    cam = cam || parts.find((p) => p.t === 'camera');
    if (!cam) return false;
    return parts.some((p) => p !== cam && p.x === cam.x && p.y === cam.y && p.z < cam.z);
  };
  // Where a camera would go automatically: on top of the highest middle part, frontmost first
  CW.autoCameraSpot = function (parts) {
    const mid = parts.filter((p) => p.x === 0 && p.t !== 'camera');
    const top = Math.max(...mid.map((p) => p.y));
    const tops = mid.filter((p) => p.y === top).sort((a, b) => a.z - b.z);
    for (const p of tops) {
      const spot = { x: 0, y: top + 1, z: p.z };
      if (!parts.some((q) => q.x === spot.x && q.y === spot.y && q.z === spot.z)) return spot;
    }
    return { x: 0, y: top + 1, z: 0 };
  };
  // Returns parts with exactly one unblocked camera
  CW.ensureCamera = function (parts) {
    const cams = parts.filter((p) => p.t === 'camera');
    let out = parts;
    if (cams.length === 1 && !CW.cameraBlocked(parts, cams[0])) return { parts, moved: false };
    out = parts.filter((p) => p.t !== 'camera');
    const spot = CW.autoCameraSpot(out);
    out = out.concat([{ t: 'camera', ...spot }]);
    return { parts: out, moved: true };
  };

  // ---------- Presets ----------
  const P = (list) => CW.ensureCamera(list.map(([t, x, y, z]) => ({ t, x, y, z }))).parts;
  CW.PRESETS = [
    {
      id: 'buggy', name: 'Scout Buggy', bot: true, ai: 'ground', desc: 'Fast 4-wheeler with twin cannons.',
      parts: P([['core', 0, 0, 0], ['frame', 0, 0, -1], ['frame', 0, 0, 1], ['wheel', -1, 0, -1], ['wheel', 1, 0, -1], ['wheel', -1, 0, 1], ['wheel', 1, 0, 1], ['cannon', 0, 1, -1], ['cannon', 0, 1, 0], ['engine', 0, 1, 1]]),
    },
    {
      id: 'spider', name: 'Spider', bot: true, ai: 'ground', desc: 'Four legs, climbs cliffs, rockets.',
      parts: P([['core', 0, 0, 0], ['armor', 0, 0, -1], ['frame', 0, 0, 1], ['leg', -1, 0, -1], ['leg', 1, 0, -1], ['leg', -1, 0, 1], ['leg', 1, 0, 1], ['rocket', 0, 1, 0], ['cannon', 0, 1, -1], ['engine', 0, 1, 1]]),
    },
    {
      id: 'hornet', name: 'Hornet', bot: true, ai: 'heli', desc: 'Quad-rotor gunship with a jet.',
      parts: P([['core', 0, 0, 0], ['frame', 0, 0, -1], ['frame', 0, 0, 1], ['rotor', -1, 0, -1], ['rotor', 1, 0, -1], ['rotor', -1, 0, 1], ['rotor', 1, 0, 1], ['jet', 0, 0, 2], ['cannon', 0, 1, -1], ['cannon', 0, -1, 0], ['engine', 0, 1, 0], ['engine', 0, 1, 1]]),
    },
    {
      id: 'gunboat', name: 'Gunboat', bot: true, ai: 'boat', desc: 'Floating rocket platform.',
      parts: P([['core', 0, 0, 0], ['frame', 0, 0, -1], ['frame', 0, 0, 1], ['float', -1, 0, -1], ['float', 1, 0, -1], ['float', -1, 0, 0], ['float', 1, 0, 0], ['float', -1, 0, 1], ['float', 1, 0, 1], ['prop', -1, 0, 2], ['prop', 1, 0, 2], ['rocket', 0, 1, 0], ['cannon', 0, 1, -1], ['engine', 0, 1, 1]]),
    },
    {
      id: 'mudcrab', name: 'Mudcrab', bot: true, ai: 'ground', desc: 'Amphibious: drives and swims.',
      parts: P([['core', 0, 0, 0], ['frame', 0, 0, -1], ['frame', 0, 0, 1], ['wheel', -1, 0, -1], ['wheel', 1, 0, -1], ['wheel', -1, 0, 1], ['wheel', 1, 0, 1], ['float', -1, 0, 0], ['float', 1, 0, 0], ['float', -1, 1, 0], ['float', 1, 1, 0], ['prop', 0, 0, 2], ['cannon', 0, 1, -1], ['cannon', 0, 1, 0], ['engine', 0, 1, 1]]),
    },
    {
      id: 'raptor', name: 'Skyraptor', bot: true, ai: 'plane', desc: 'Takes off on wheels, flies on wings.',
      parts: P([['core', 0, 0, 0], ['frame', 0, 0, -1], ['frame', 0, 0, 1], ['wing', -1, 0, 0], ['wing', 1, 0, 0], ['wing', -2, 0, 0], ['wing', 2, 0, 0], ['wheel', 0, -1, -1], ['wheel', 0, -1, 1], ['jet', -1, 0, 1], ['jet', 1, 0, 1], ['cannon', 0, 1, -1], ['engine', 0, 1, 0], ['engine', 0, 1, 1]]),
    },
    {
      id: 'rhino', name: 'Rhino', bot: true, ai: 'rammer', desc: 'Spiked rammer with boosters and a laser.',
      parts: P([['core', 0, 0, 0], ['frame', 0, 0, 1], ['armor', 0, 0, -1], ['spikes', 0, 0, -2], ['spikes', -1, 0, -2], ['spikes', 1, 0, -2], ['wheel', -1, 0, -1], ['wheel', 1, 0, -1], ['wheel', -1, 0, 1], ['wheel', 1, 0, 1], ['booster', 0, 0, 2], ['laser', 0, 1, 0], ['engine', 0, 1, 1]]),
    },
    {
      id: 'reaper', name: 'Reaper', bot: true, ai: 'rammer', desc: 'Leg-walker with saws and a flamethrower.',
      parts: P([['core', 0, 0, 0], ['frame', 0, 0, 1], ['armor', 0, 0, -1], ['saw', -1, 0, -1], ['saw', 1, 0, -1], ['leg', -1, 0, 0], ['leg', 1, 0, 0], ['leg', -1, 0, 1], ['leg', 1, 0, 1], ['flamer', 0, 1, -1], ['engine', 0, 1, 1], ['booster', 0, 0, 2]]),
    },
    {
      id: 'lancer', name: 'Lancer', bot: true, ai: 'heli', desc: 'Sniper gunship with a railgun.',
      parts: P([['core', 0, 0, 0], ['frame', 0, 0, -1], ['frame', 0, 0, 1], ['rotor', -1, 0, -1], ['rotor', 1, 0, -1], ['rotor', -1, 0, 1], ['rotor', 1, 0, 1], ['railgun', 0, 1, -1], ['engine', 0, 1, 0], ['engine', 0, 1, 1], ['drone', 0, -1, 0]]),
    },
    {
      id: 'leviathan', name: 'Leviathan', bot: true, ai: 'heli', desc: 'Omni beast: drives, floats and hovers.',
      parts: P([['core', 0, 0, 0], ['frame', 0, 0, -1], ['frame', 0, 0, 1], ['frame', -1, 0, 0], ['frame', 1, 0, 0], ['wheel', -1, 0, -1], ['wheel', 1, 0, -1], ['wheel', -1, 0, 1], ['wheel', 1, 0, 1], ['float', -1, 1, -1], ['float', 1, 1, -1], ['float', -1, 1, 1], ['float', 1, 1, 1], ['rotor', -2, 0, 0], ['rotor', 2, 0, 0], ['rotor', -2, 0, 1], ['rotor', 2, 0, 1], ['prop', 0, 0, 2], ['cannon', 0, 1, -1], ['engine', 0, 1, 0], ['engine', 0, 1, 1]]),
    },
  ];

  CW.PAINTS = [0x3a86ff, 0xff006e, 0xfb5607, 0x8338ec, 0x06d6a0, 0xffbe0b, 0x00b4d8, 0xe63946, 0x6c757d, 0xf1f3f5];

  CW.cloneBp = (bp) => {
    const out = { name: bp.name, parts: bp.parts.map((p) => ({ t: p.t, x: p.x, y: p.y, z: p.z })) };
    if (bp.color) out.color = bp.color;
    return out;
  };

  CW.encodeBp = function (bp) {
    const data = { n: bp.name, c: bp.color, p: bp.parts.map((p) => [p.t, p.x, p.y, p.z]) };
    return 'CW1:' + btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  };
  CW.decodeBp = function (code) {
    code = (code || '').trim();
    if (!code.startsWith('CW1:')) throw new Error('Not a Cogwild blueprint code');
    const data = JSON.parse(decodeURIComponent(escape(atob(code.slice(4)))));
    const parts = data.p
      .filter((a) => CW.PARTS[a[0]])
      .map(([t, x, y, z]) => ({ t, x: x | 0, y: y | 0, z: z | 0 }));
    if (!parts.some((p) => p.t === 'core')) throw new Error('Blueprint has no core');
    const out = { name: String(data.n || 'Imported').slice(0, 24), parts };
    const allPaints = CW.PAINTS.concat(CW.SHOP ? CW.SHOP.paints.map((p) => p.color) : []);
    if (allPaints.includes(data.c)) out.color = data.c;
    return out;
  };

  // Keep only parts connected to the core (face-adjacent)
  CW.connected = function (parts) {
    const key = (p) => p.x + ',' + p.y + ',' + p.z;
    const map = new Map(parts.map((p) => [key(p), p]));
    const core = parts.find((p) => p.t === 'core');
    if (!core) return [];
    const seen = new Set([key(core)]);
    const q = [core];
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    while (q.length) {
      const c = q.pop();
      for (const [dx, dy, dz] of dirs) {
        const k = c.x + dx + ',' + (c.y + dy) + ',' + (c.z + dz);
        if (!seen.has(k) && map.has(k)) { seen.add(k); q.push(map.get(k)); }
      }
    }
    return parts.filter((p) => seen.has(key(p)));
  };
})();
