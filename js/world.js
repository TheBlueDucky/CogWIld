// Cogwild — arena: terrain (land), lake + canyon river (water), bridges, decor, minimap
(function () {
  const CW = window.CW;

  function hash(i, j) {
    let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z);
    const xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, z) {
    let s = 0, a = 0.5, f = 1;
    for (let i = 0; i < 4; i++) { s += a * vnoise(x * f, z * f); f *= 2.03; a *= 0.5; }
    return s / 0.9375;
  }
  const ss = (e0, e1, x) => {
    let t = (x - e0) / (e1 - e0);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  CW.smoothstep = ss;
  CW.lerp = lerp;
  CW.hash = hash;

  CW.LAKE = { x: -70, z: 60 };
  CW.canyonX = (z) => 55 + 14 * Math.sin(z / 38);
  CW.RAMPS_Z = [-100, 22]; // gentle slopes into the canyon river

  const edgeRise = (x, z) => ss(166, 195, Math.max(Math.abs(x), Math.abs(z))) * 35;
  const C = (hex) => new THREE.Color(hex);

  // ---------- Arena 1: Canyon Lake (meadows, lake, canyon river, mountain) ----------
  function canyonHeight(x, z) {
    let h = 3 + fbm(x * 0.011 + 10, z * 0.011 - 4) * 14;
    h += 3 * Math.sin(x * 0.03) * Math.cos(z * 0.025);
    const dm = Math.hypot(x - 115, z + 115);
    h += 42 * Math.exp(-(dm * dm) / (2 * 32 * 32));
    const dm2 = Math.hypot(x + 120, z + 105);
    h += 18 * Math.exp(-(dm2 * dm2) / (2 * 22 * 22));
    const dl = Math.hypot(x - CW.LAKE.x, z - CW.LAKE.z);
    h = lerp(h, -14, ss(78, 40, dl));
    const dc = Math.abs(x - CW.canyonX(z));
    const fade = ss(158, 118, Math.abs(z));
    let ramp = 0;
    for (const rz of CW.RAMPS_Z) ramp = Math.max(ramp, Math.exp(-((z - rz) * (z - rz)) / (2 * 11 * 11)));
    h = lerp(h, -10, ss(24 + ramp * 42, 9, dc) * fade);
    return h + edgeRise(x, z);
  }
  function canyonColor(h, slope, n, out) {
    if (h < -1) return out.copy(C(0xd9c48e)).lerp(C(0x4f8a8b), Math.min(1, -h / 14));
    if (h < 1.8) return out.setHex(0xf2dfa0);
    if (slope > 1.0) return out.setHex(n > 0.5 ? 0x9a8f86 : 0x857a72);
    if (h > 34) return out.setHex(0xf5f7ff);
    if (h > 24) return out.copy(C(0x8a9a6b)).lerp(C(0xa39e93), ss(24, 34, h));
    return out.copy(C(0x74bf4e)).lerp(C(0x3f8a34), n * 0.8 + slope * 0.3);
  }

  // ---------- Arena 2: Frost Isles (snowy islands, icy sea, bridges) ----------
  const ISLES = [
    { x: 0, z: 0, r: 62, h: 22 },
    { x: 122, z: 0, r: 40, h: 18 }, { x: -122, z: 0, r: 40, h: 18 },
    { x: 0, z: 122, r: 40, h: 18 }, { x: 0, z: -122, r: 40, h: 18 },
  ];
  function islesHeight(x, z) {
    let land = 0;
    for (const is of ISLES) {
      const d = Math.hypot(x - is.x, z - is.z);
      land = Math.max(land, is.h * ss(is.r + 25, is.r * 0.45, d)); // wide, gentle beaches
    }
    const n = fbm(x * 0.02 + 3, z * 0.02 + 7);
    let h = -12 + land + (land > 4 ? (n - 0.5) * 8 : (n - 0.5) * 3);
    const dc = Math.hypot(x, z);
    h += 30 * Math.exp(-(dc * dc) / (2 * 16 * 16)); // ice peak in the middle
    return h + edgeRise(x, z);
  }
  function islesColor(h, slope, n, out) {
    if (h < -1) return out.copy(C(0xcfe9f2)).lerp(C(0x2c5d7c), Math.min(1, -h / 12));
    if (h < 1.6) return out.setHex(0xdff3ff);
    if (slope > 1.0) return out.setHex(n > 0.5 ? 0x8fa3b8 : 0x7a8ea3);
    if (h > 20) return out.copy(C(0xe8f6ff)).lerp(C(0xa8dcff), n * 0.6);
    return out.copy(C(0xf4f9ff)).lerp(C(0xc9dde8), n * 0.7 + slope * 0.3);
  }

  // ---------- Arena 3: Volcano Rift (lava moat around a volcano, bridges, burnt land) ----------
  function volcanoHeight(x, z) {
    const d = Math.hypot(x, z);
    let h = 6 + fbm(x * 0.018 + 5, z * 0.018 - 9) * 11;
    h = lerp(h, -6, ss(17, 7, Math.abs(d - 72))); // lava moat ring
    h += 44 * Math.exp(-(d * d) / (2 * 21 * 21)); // the volcano cone
    h = lerp(h, -3, ss(13, 6, d)); // crater full of lava
    const dp = Math.hypot(x + 110, z - 100);
    h = lerp(h, -4, ss(26, 12, dp)); // a lava pool in the outer lands
    return h + edgeRise(x, z);
  }
  function volcanoColor(h, slope, n, out) {
    if (h < -0.5) return out.setHex(0x3a1208);
    if (h < 2) return out.copy(C(0x7a2c14)).lerp(C(0x3a2a26), ss(-0.5, 2, h)); // scorched shore
    if (slope > 1.0) return out.setHex(n > 0.5 ? 0x3d3a3a : 0x2e2b2b);
    if (h > 30) return out.copy(C(0x4a3b36)).lerp(C(0x6b5a52), n);
    return out.copy(C(0x4b4743)).lerp(C(0x35302d), n * 0.8 + slope * 0.3);
  }

  // ---------- Arena 4: Desert Mesa (dunes, flat-topped mesas with ramps, an oasis) ----------
  const MESAS = [
    { x: 85, z: -65, r: 30, h: 22, ramp: 2.4 }, { x: -95, z: -85, r: 26, h: 28, ramp: 0.6 },
    { x: 45, z: 100, r: 22, h: 16, ramp: 4.0 }, { x: -15, z: -10, r: 18, h: 12, ramp: 1.6 }, { x: 120, z: 70, r: 20, h: 18, ramp: 3.3 },
  ];
  function desertHeight(x, z) {
    let h = 5 + Math.sin(x * 0.045 + Math.sin(z * 0.02) * 2) * 1.8 + fbm(x * 0.012, z * 0.03) * 5;
    for (const m of MESAS) {
      const d = Math.hypot(x - m.x, z - m.z);
      const a = Math.atan2(z - m.z, x - m.x);
      const rampF = Math.pow(Math.max(0, Math.cos(a - m.ramp)), 6); // one gentle side to drive up
      const top = m.h * ss(m.r + 5 + rampF * 32, m.r - 2, d);
      h = Math.max(h, 5 + top);
    }
    const dO = Math.hypot(x + 60, z - 70);
    h = lerp(h, -6, ss(34, 18, dO)); // oasis
    return h + edgeRise(x, z);
  }
  function desertColor(h, slope, n, out) {
    if (h < -0.5) return out.copy(C(0xcfb27a)).lerp(C(0x3f7f86), Math.min(1, -h / 6));
    if (h < 2.5) return out.setHex(0x8fae4f); // green oasis rim
    if (slope > 0.9 || h > 13) { // banded red rock
      const band = Math.sin(h * 1.3) * 0.5 + 0.5;
      return out.copy(C(0xb4532a)).lerp(C(0xd9824a), band * 0.7 + n * 0.3);
    }
    return out.copy(C(0xf0cf8a)).lerp(C(0xdcae68), n * 0.8 + slope * 0.4);
  }

  // ---------- Arena 5: Toxic Swamp (mud islands, toxic sludge, giant mushrooms) ----------
  function swampHeight(x, z) {
    let h = 3.2 + (fbm(x * 0.02 + 40, z * 0.02 - 13) - 0.5) * 14 + Math.sin(x * 0.05) * Math.cos(z * 0.04) * 2;
    for (const [px, pz, r] of [[0, 0, 40], [100, 95, 32], [-105, -95, 32], [100, -100, 28], [-100, 100, 28]]) {
      h = Math.max(h, lerp(h, 6.5, ss(r, r * 0.6, Math.hypot(x - px, z - pz)))); // dry island plateaus
    }
    return h + edgeRise(x, z);
  }
  function swampColor(h, slope, n, out) {
    if (h < -0.5) return out.copy(C(0x5b5a2e)).lerp(C(0x2e3b1a), Math.min(1, -h / 6));
    if (h < 1.6) return out.setHex(0x4a3f2a); // wet mud
    if (slope > 1) return out.setHex(0x5a5048);
    return out.copy(C(0x5f7d35)).lerp(C(0x3b5a28), n * 0.8 + slope * 0.3);
  }

  // ---------- Arena 6: Neon City (street grid, climbable buildings, a central plaza) ----------
  const BLOCK = 34, STREET = 12;
  function cityBuilding(ix, iz) {
    if (Math.abs(ix) <= 0 && Math.abs(iz) <= 0) return 0; // plaza in the middle
    const r = hash(ix + 50, iz + 77);
    if (r < 0.18) return 0; // parks and parking lots
    return 6 + Math.floor(hash(ix + 9, iz + 3) * 5) * 5; // 6..26 m tall
  }
  function cityHeight(x, z) {
    const ix = Math.round(x / BLOCK), iz = Math.round(z / BLOCK);
    const lx = Math.abs(x - ix * BLOCK), lz = Math.abs(z - iz * BLOCK);
    const half = (BLOCK - STREET) / 2;
    let h = 3;
    const b = cityBuilding(ix, iz);
    if (b) h += b * ss(half + 1, half - 1, Math.max(lx, lz)); // steep building walls
    // some buildings get a ramp up one side (for wheels)
    if (b && hash(ix, iz) > 0.6) {
      const along = z - iz * BLOCK; // ramp on the +z face
      if (lx < 4 && along > half - 1 && along < half + 12) h = Math.max(h, 3 + b * ss(half + 12, half - 1, along));
    }
    return h + edgeRise(x, z);
  }
  function cityColor(h, slope, n, out) {
    if (h < 3.4) return out.copy(C(0x2b2d42)).lerp(C(0x3a3d55), n * 0.5); // asphalt
    if (slope > 1) return out.copy(C(0x3d3a63)).lerp(C(0x4f4a7a), n);
    return out.copy(C(0x5c5f80)).lerp(C(0x7a7da0), n * 0.6); // rooftops
  }

  // ---------- Arena 7: Jungle Temple (river, palms, a giant stepped pyramid) ----------
  const riverX = (z) => -95 + 22 * Math.sin(z / 32);
  function jungleHeight(x, z) {
    let h = 4 + fbm(x * 0.016 - 7, z * 0.016 + 21) * 13;
    // stepped temple pyramid with a stairway on the south side
    const m = Math.max(Math.abs(x), Math.abs(z));
    let tier = 0;
    for (const s of [40, 32, 24, 16]) if (m < s) tier += 4.5;
    if (tier > 0) h = Math.max(lerp(h, 4, ss(48, 40, m)), 4 + tier);
    else h = lerp(h, 4, ss(48, 40, m)); // clearing around the temple
    if (Math.abs(x) < 5 && z > 8 && z < 48) h = Math.max(h, 4 + Math.max(0, (48 - z) * 0.46)); // stairs (wheels can climb)
    h = lerp(h, -8, ss(20, 8, Math.abs(x - riverX(z)))); // river
    return h + edgeRise(x, z);
  }
  function jungleColor(h, slope, n, out) {
    if (h < -0.5) return out.copy(C(0x8a7a4a)).lerp(C(0x2f5f4f), Math.min(1, -h / 8));
    if (h < 1.8) return out.setHex(0xa08a58);
    if (slope > 1.1) return out.setHex(n > 0.5 ? 0x8a8268 : 0x6f6a55); // mossy stone
    if (h > 8 && h < 26 && slope < 0.2) return out.copy(C(0xb8a77a)).lerp(C(0x8f9a5a), n * 0.5); // temple steps
    return out.copy(C(0x3fa34d)).lerp(C(0x1f6b2f), n * 0.8 + slope * 0.3);
  }

  // ---------- Arena 8: Scrap Yard (junk heaps to climb, a flooded pit, a compactor ring, a crane rail) ----------
  const HEAPS = [[-70, -60, 30, 24], [80, -75, 32, 28], [-90, 70, 28, 22], [60, 95, 30, 24], [0, -125, 24, 18], [-132, -5, 22, 16], [128, 15, 24, 18], [-20, 115, 20, 14]];
  function scrapHeight(x, z) {
    let h = 3 + (fbm(x * 0.03 + 11, z * 0.03 - 5) - 0.5) * 3;
    for (const [hx, hz, r, top] of HEAPS) {
      const d = Math.hypot(x - hx, z - hz);
      if (d < r) { const k = 1 - d / r; h = Math.max(h, 3 + top * Math.pow(k, 1.4) + fbm(x * 0.18 + hx, z * 0.18 + hz) * 4 * k); }
    }
    h = lerp(h, 2.2, ss(42, 30, Math.hypot(x, z))); // the compactor floor in the middle
    h = lerp(h, -7, ss(28, 15, Math.hypot(x - 48, z - 22))); // flooded pit
    if (Math.abs(z + 32) < 3.5 && Math.abs(x) < 112) h = Math.max(h, 6 * ss(112, 96, Math.abs(x)) + 3); // crane rail
    return h + edgeRise(x, z);
  }
  function scrapColor(h, slope, n, out) {
    if (h < -0.5) return out.copy(C(0x6a5a44)).lerp(C(0x2a3a3a), Math.min(1, -h / 6)); // muddy water edge
    if (h < 2) return out.setHex(0x6e5c46);
    if (h > 6.5 || slope > 0.75) return out.copy(C(0x8a4b2a)).lerp(C(0x6b7078), n); // rust and old steel
    return out.copy(C(0x8c7b62)).lerp(C(0x6e5f4a), n * 0.8 + slope * 0.3); // packed dirt
  }

  CW.ARENAS = {
    canyon: {
      id: 'canyon', name: 'Canyon Lake', icon: '🏞', desc: 'Meadows, a lake, a canyon river and a mountain.',
      height: canyonHeight, color: canyonColor,
      bridges: [{ x: CW.canyonX(-35), z: -35, axis: 'x' }, { x: CW.canyonX(75), z: 75, axis: 'x' }],
      waterCenter: CW.LAKE, crystals: { x: 115, z: -115 }, grass: true, snow: false,
      trees: { leaf: 0x2d9c55, leaf2: 0x3fbf6a, trunk: 0x8b5a2b, rock: 0x9e9e9e },
    },
    isles: {
      id: 'isles', name: 'Frost Isles', icon: '🏔', desc: 'Snowy islands linked by bridges across an icy sea.',
      height: islesHeight, color: islesColor,
      bridges: [{ x: 71, z: 0, axis: 'x' }, { x: -71, z: 0, axis: 'x' }, { x: 0, z: 71, axis: 'z' }, { x: 0, z: -71, axis: 'z' }],
      waterCenter: { x: 60, z: 60 }, crystals: { x: 0, z: 0 }, grass: false, particles: 'snow',
      trees: { leaf: 0xd8ecf2, leaf2: 0xffffff, trunk: 0x6b4a2b, rock: 0xbfe6ff },
    },
    volcano: {
      id: 'volcano', name: 'Volcano Rift', icon: '🌋', desc: 'A lava moat around a smoking volcano. Lava burns!',
      height: volcanoHeight, color: volcanoColor,
      bridges: [{ x: 72, z: 0, axis: 'x' }, { x: -72, z: 0, axis: 'x' }, { x: 0, z: 72, axis: 'z' }, { x: 0, z: -72, axis: 'z' }],
      waterCenter: { x: 72, z: 40 }, crystals: { x: 0, z: 0 }, grass: false, particles: 'embers', lava: true, liquid: 'lava',
      tint: { sky: 0xff6a3a, fog: 0x5a2a1a, top: 0x2a1414 },
      trees: { leaf: 0x2b2b2b, leaf2: 0x3a3a3a, trunk: 0x1f1a17, rock: 0x3a3534 },
    },
    desert: {
      id: 'desert', noBoats: true, name: 'Desert Mesa', icon: '🏜', desc: 'Dunes and tall mesas (each has one ramp up), plus a small oasis.',
      height: desertHeight, color: desertColor, bridges: [],
      waterCenter: { x: -60, z: 70 }, crystals: { x: 85, z: -65 }, grass: false, particles: 'dust',
      tint: { sky: 0xffc27a, fog: 0xe9c79a }, crystalColors: [[0x5cf2ff, 0x177f8a], [0xffd23f, 0xa06000]],
      trees: { shape: 'cactus', leaf: 0x4f9a3a, leaf2: 0x5aa844, trunk: 0x3f8a32, rock: 0xc98a5a, density: 0.55, count: 160 },
    },
    swamp: {
      id: 'swamp', name: 'Toxic Swamp', icon: '☣', desc: 'Mud islands in glowing toxic sludge. The sludge eats mechs, slowly.',
      height: swampHeight, color: swampColor,
      bridges: [{ x: 0, z: 62, axis: 'z' }, { x: 0, z: -62, axis: 'z' }, { x: 60, z: 0, axis: 'x' }, { x: -60, z: 0, axis: 'x' }],
      waterCenter: { x: 50, z: 50 }, crystals: { x: 0, z: 0 }, grass: true, particles: 'fireflies', liquid: 'toxic',
      tint: { sky: 0x9ccf7a, fog: 0x6f8f5a }, crystalColors: [[0x9dff3a, 0x3f8a00], [0xc77dff, 0x5a189a]],
      trees: { shape: 'mushroom', leaf: 0xd62828, leaf2: 0xfff1d0, trunk: 0xe9e1c9, rock: 0x5a5048, density: 0.5, count: 140 },
    },
    city: {
      id: 'city', noBoats: true, name: 'Neon City', icon: '🌆', desc: 'A street grid with buildings to climb or fly over. A plaza in the middle.',
      height: cityHeight, color: cityColor, bridges: [],
      waterCenter: { x: 0, z: 0 }, crystals: { x: 0, z: 0 }, grass: false, neon: true,
      tint: { sky: 0xb06ab3, fog: 0x4a3a6c }, crystalColors: [[0xff4fd8, 0xc000b0], [0x4cc9f0, 0x0b7a8c]],
      trees: { shape: 'pine', leaf: 0x2d9c55, leaf2: 0x3fbf6a, trunk: 0x8b5a2b, rock: 0x6c757d, count: 0 },
    },
    jungle: {
      id: 'jungle', noBoats: true, name: 'Jungle Temple', icon: '🛕', desc: 'A river, thick palms and a giant stepped temple to fight over.',
      height: jungleHeight, color: jungleColor,
      bridges: [{ x: riverX(-60), z: -60, axis: 'x' }, { x: riverX(60), z: 60, axis: 'x' }],
      waterCenter: { x: riverX(0), z: 0 }, crystals: { x: 0, z: 0 }, grass: true, particles: 'fireflies',
      crystalColors: [[0x2ec27e, 0x0b6b3a], [0xffd23f, 0xa06000]],
      trees: { shape: 'palm', leaf: 0x2f9e44, leaf2: 0x8b5a2b, trunk: 0x9c6b3c, rock: 0x8a8268, density: 0.35, count: 300 },
    },
    scrap: {
      id: 'scrap', name: 'Scrap Yard', icon: '🏗', desc: 'Junk heaps to climb, a flooded pit, a crane rail and the compactor ring in the middle.',
      height: scrapHeight, color: scrapColor, bridges: [],
      waterCenter: { x: 48, z: 22 }, crystals: { x: 0, z: 0 }, grass: false, particles: 'dust', scrap: true,
      tint: { sky: 0xd9b38c, fog: 0xb8a088 }, crystalColors: [[0xffb000, 0x8a4b00], [0x4cc9f0, 0x0b7a8c]],
      trees: { shape: 'pine', leaf: 0x556b2f, leaf2: 0x6b8e23, trunk: 0x5a3e2b, rock: 0x7a5c48, density: 0.2, count: 50 },
    },
  };
  // harmful liquids: damage per second to mech parts touching them and to pilots in them
  CW.LIQUID_HARM = {
    lava: { mech: 6, pilot: 30, msg: '🔥 LAVA!', fx: 'fire' },
    toxic: { mech: 3, pilot: 12, msg: '☣ TOXIC SLUDGE!', fx: 'toxic' },
  };
  CW.arena = CW.ARENAS.canyon;
  CW.terrainHeight = (x, z) => CW.arena.height(x, z);

  CW.TIMES = {
    day: { label: '☀ Day', top: 0x2f7fd8, bottom: 0xc4e9ff, fog: 0xaedcff, sun: 0xfff4e0, sunI: 0.95, hemiSky: 0xdff1ff, hemiGround: 0x4a6b3a, hemiI: 0.65, sunDir: [0.45, 0.8, 0.3], water: 0x2e9be6, disc: 0xfff6c8, discSize: 70, stars: 0, cloud: 0xffffff, cloudE: 0x666666 },
    sunset: { label: '🌅 Sunset', top: 0x27306b, bottom: 0xff9a5c, fog: 0xe8a07a, sun: 0xffb070, sunI: 0.9, hemiSky: 0xffc9a0, hemiGround: 0x4f3448, hemiI: 0.55, sunDir: [0.85, 0.18, -0.45], water: 0x35659e, disc: 0xffa040, discSize: 110, stars: 0.25, cloud: 0xffb48a, cloudE: 0x6b3a3a },
    night: { label: '🌙 Night', top: 0x03061a, bottom: 0x18244d, fog: 0x141d3d, sun: 0xa8bcff, sunI: 0.4, hemiSky: 0x5b6fb0, hemiGround: 0x0c1220, hemiI: 0.5, sunDir: [-0.4, 0.75, -0.35], water: 0x14365f, disc: 0xe8eeff, discSize: 45, stars: 1, cloud: 0x3a4670, cloudE: 0x111a33 },
  };

  // Build a reflection map from a simple sky gradient (+ ground color), for shiny metal parts
  CW.makeEnv = function (renderer, top, bottom, ground) {
    const s = new THREE.Scene();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) }, ground: { value: new THREE.Color(ground) } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 bottom; uniform vec3 ground; varying vec3 vP; void main(){ vec3 c = vP.y > 0.0 ? mix(bottom, top, pow(vP.y, 0.7)) : mix(bottom, ground, min(1.0, -vP.y * 4.0)); gl_FragColor = linearToOutputTexel(vec4(c, 1.0)); }',
      })
    );
    s.add(dome);
    // a bright patch where the sun is, for a nice highlight
    const sun = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 8), new THREE.MeshBasicMaterial({ color: 0xbbbbbb }));
    sun.position.set(25, 35, 15);
    s.add(sun);
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromScene(s, 0.03);
    pm.dispose();
    dome.geometry.dispose(); dome.material.dispose(); sun.geometry.dispose(); sun.material.dispose();
    return rt;
  };

  class World {
    constructor(scene, arenaId) {
      // everything the world builds lives in one group, so arenas can be swapped
      this.arena = CW.ARENAS[arenaId] || CW.ARENAS.canyon;
      CW.arena = this.arena;
      this.realScene = scene;
      this.scene = new THREE.Group();
      scene.add(this.scene);
      this.bridges = [];
      this.buildSky();
      this.buildBridges();
      this.buildTerrain();
      this.buildWater();
      this.buildDecor();
      this.buildGrass();
      this.buildClouds();
      this.computeSpawns();
      this.buildMinimap();
      this.buildBoundary();
      if (this.arena.particles) this.buildSnow();
    }

    dispose() {
      this.realScene.remove(this.scene);
      this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }

    // is (x,z) on a bridge deck? (margin widens the test)
    onBridge(x, z, margin = 0) {
      return this.bridges.find((b) => {
        const along = b.axis === 'x' ? x : z, cross = b.axis === 'x' ? z : x;
        return along > b.a0 - margin && along < b.a1 + margin && Math.abs(cross - b.c) < b.w + margin;
      });
    }

    // falling snow around the camera
    buildSnow() {
      const N = 1800, pts = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { pts[i * 3] = (Math.random() - 0.5) * 120; pts[i * 3 + 1] = Math.random() * 60; pts[i * 3 + 2] = (Math.random() - 0.5) * 120; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const cv = document.createElement('canvas');
      cv.width = cv.height = 32;
      const ctx = cv.getContext('2d');
      const grd = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.5, 'rgba(255,255,255,0.8)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 32, 32);
      this.snow = new THREE.Points(g, new THREE.PointsMaterial({ color: { snow: 0xffffff, embers: 0xff7a2a, dust: 0xe8c890, fireflies: 0xd8ff6a }[this.arena.particles], size: { snow: 0.45, embers: 0.3, dust: 0.35, fireflies: 0.4 }[this.arena.particles], map: new THREE.CanvasTexture(cv), transparent: true, opacity: 0.9, depthWrite: false }));
      this.scene.add(this.snow);
    }
    updateSnow(dt, cam) {
      if (!this.snow || !cam) return;
      const p = this.snow.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const kind = this.arena.particles;
        let y = p.getY(i) + dt * ({ snow: -4, embers: 3, dust: -0.4, fireflies: Math.sin(this.t + i) * 0.8 }[kind]); // snow falls, embers rise, dust drifts
        let x = p.getX(i) + (kind === 'dust' ? dt * 7 : Math.sin(this.t * 0.7 + i) * dt * (kind === 'fireflies' ? 1.5 : 0.6));
        if (x > 60) x -= 120;
        if (y < 0) y += 60;
        if (y > 60) y -= 60;
        p.setXY(i, x, y);
      }
      p.needsUpdate = true;
      this.snow.position.set(Math.round(cam.x / 120) * 120, cam.y - 30, Math.round(cam.z / 120) * 120);
    }

    // Glowing force-field walls around the arena + a ceiling grid
    buildBoundary() {
      const cv = document.createElement('canvas');
      cv.width = 128; cv.height = 128;
      const ctx = cv.getContext('2d');
      const grd = ctx.createLinearGradient(0, 0, 0, 128);
      grd.addColorStop(0, 'rgba(120,220,255,0)');
      grd.addColorStop(1, 'rgba(120,220,255,0.9)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 3;
      for (let i = -128; i < 256; i += 32) { ctx.beginPath(); ctx.moveTo(i, 128); ctx.lineTo(i + 128, 0); ctx.stroke(); }
      const tex = new THREE.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(30, 1);
      this.wallTex = tex;
      this.wallMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
      const L = CW.ARENA_HALF * 2, H = CW.CEILING + 20;
      const walls = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(L, H), this.wallMat);
        const a = (i * Math.PI) / 2;
        w.position.set(Math.sin(a) * CW.ARENA_HALF, H / 2 - 20, Math.cos(a) * CW.ARENA_HALF);
        w.rotation.y = a;
        w.renderOrder = 3;
        walls.add(w);
      }
      this.walls = walls;
      this.scene.add(walls);
      const ceil = new THREE.GridHelper(L, 24, 0x9be7ff, 0x9be7ff);
      ceil.position.y = CW.CEILING;
      ceil.material.transparent = true;
      ceil.material.opacity = 0.0;
      ceil.material.depthWrite = false;
      this.ceiling = ceil;
      this.scene.add(ceil);
    }

    // walls glow brighter the closer you are
    updateBoundary(dt, pos) {
      if (!this.wallTex) return;
      this.wallTex.offset.x += dt * 0.15;
      if (!pos) { this.wallMat.opacity = 0; this.walls.visible = false; this.ceiling.material.opacity = 0; return; }
      const edge = CW.ARENA_HALF - Math.max(Math.abs(pos.x), Math.abs(pos.z));
      this.wallMat.opacity = 0.7 * Math.max(0, 1 - edge / 28);
      this.walls.visible = this.wallMat.opacity > 0.01;
      this.ceiling.material.opacity = 0.5 * Math.max(0, 1 - (CW.CEILING - pos.y) / 25);
      return { edge, ceiling: CW.CEILING - pos.y };
    }

    // Gradient sky dome, sun/moon glow and stars
    buildSky() {
      this.skyUniforms = { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } };
      const sky = new THREE.Mesh(
        new THREE.SphereGeometry(700, 32, 16),
        new THREE.ShaderMaterial({
          uniforms: this.skyUniforms,
          side: THREE.BackSide,
          depthWrite: false,
          fog: false,
          vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y * 1.6 + 0.05, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.8)), 1.0); }',
        })
      );
      sky.renderOrder = -10;
      this.sky = sky;
      this.scene.add(sky);
      // sun / moon glow sprite
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const ctx = cv.getContext('2d');
      const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.18, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), fog: false, depthWrite: false, transparent: true }));
      this.scene.add(this.sunSprite);
      // stars
      const pts = [];
      for (let i = 0; i < 900; i++) {
        const u = hash(i, 11), v = hash(i, 23);
        const th = u * Math.PI * 2, ph = Math.acos(1 - v * 0.95);
        pts.push(Math.sin(ph) * Math.cos(th) * 650, Math.cos(ph) * 650, Math.sin(ph) * Math.sin(th) * 650);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, depthWrite: false }));
      this.scene.add(this.stars);
    }

    // Apply a time of day to sky, lights, fog, water and clouds
    applyTime(name, game) {
      const t = CW.TIMES[name] || CW.TIMES.day;
      this.time = name;
      this.skyUniforms.top.value.setHex(t.top);
      this.skyUniforms.bottom.value.setHex(t.bottom);
      const tint = this.arena.tint;
      if (tint) {
        this.skyUniforms.bottom.value.lerp(new THREE.Color(tint.sky), 0.6);
        if (tint.top) this.skyUniforms.top.value.lerp(new THREE.Color(tint.top), 0.35);
      }
      this.sunDir = new THREE.Vector3(...t.sunDir).normalize();
      this.sunSprite.material.color.setHex(t.disc);
      this.sunSprite.scale.setScalar(t.discSize);
      this.stars.material.opacity = t.stars;
      this.stars.visible = t.stars > 0;
      if (!this.arena.liquid) this.waterMat.color.setHex(t.water);
      for (const c of this.clouds) c.children.forEach((m) => { m.material.color.setHex(tint ? 0x4a3a36 : t.cloud); m.material.emissive.setHex(tint ? 0x1a0d0a : t.cloudE); });
      if (game) {
        game.skyColor.setHex(t.fog);
        if (tint) game.skyColor.lerp(new THREE.Color(tint.fog), 0.45);
        game.scene.fog.color.copy(game.skyColor);
        game.sun.color.setHex(t.sun);
        game.sun.intensity = t.sunI;
        game.hemi.color.setHex(t.hemiSky);
        game.hemi.groundColor.setHex(t.hemiGround);
        game.hemi.intensity = t.hemiI;
        game.headlight.intensity = name === 'night' ? 1.4 : name === 'sunset' ? 0.4 : 0;
        // reflections match the sky
        if (game.envRT) game.envRT.dispose();
        const groundCol = { isles: 0xdfeaf2, volcano: 0x2a1f1f, desert: 0xd9b27a, swamp: 0x3b4a28, city: 0x2b2d42, jungle: 0x2f6b35 }[this.arena.id] || 0x4f7a3a;
        game.envRT = CW.makeEnv(game.renderer, t.top, t.bottom, CW.shade(groundCol, name === 'night' ? -0.3 : 0));
        game.scene.environment = game.envRT.texture;
      }
    }

    // keep the sky centered on the camera
    updateSky(camPos) {
      this.sky.position.copy(camPos);
      this.stars.position.copy(camPos);
      if (this.sunDir) this.sunSprite.position.copy(camPos).addScaledVector(this.sunDir, 600);
    }

    // Grass tufts and flowers on the meadows
    buildGrass() {
      if (!this.arena.grass) return;
      let seed = 9001;
      const rnd = () => hash(seed++, 5);
      const tuft = new THREE.ConeGeometry(0.16, 0.45, 4);
      const flower = new THREE.IcosahedronGeometry(0.22, 0);
      const grass = new THREE.InstancedMesh(tuft, new THREE.MeshLambertMaterial({ color: 0x7fd04f, emissive: 0x24451a }), 2600);
      const flowers = new THREE.InstancedMesh(flower, new THREE.MeshBasicMaterial({ color: 0xffffff }), 700);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
      const flowerCols = [0xff6b9a, 0xffd23f, 0xffffff, 0xb28dff, 0xff8c42];
      let ng = 0, nf = 0;
      for (let tries = 0; tries < 12000 && (ng < 2600 || nf < 700); tries++) {
        const x = (rnd() - 0.5) * 340, z = (rnd() - 0.5) * 340;
        const h = CW.terrainHeight(x, z);
        if (h < 2.2 || h > 22) continue;
        if (Math.abs(CW.terrainHeight(x + 1, z) - h) > 0.8) continue;
        if (this.onBridge(x, z, 2.5)) continue;
        const sc = 0.6 + rnd() * 0.9;
        q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.4, rnd() * 6, (rnd() - 0.5) * 0.4));
        if (ng < 2600) {
          s.set(sc, sc, sc); p.set(x, h + 0.2 * sc, z); m.compose(p, q, s);
          grass.setMatrixAt(ng, m);
          col.setHSL(0.25 + rnd() * 0.06, 0.55, 0.55 + rnd() * 0.12);
          grass.setColorAt(ng, col);
          ng++;
        }
        if (nf < 700 && rnd() < 0.3) {
          s.setScalar(0.7 + rnd() * 0.6); p.set(x + 0.5, h + 0.25, z + 0.3); m.compose(p, q, s);
          flowers.setMatrixAt(nf, m);
          flowers.setColorAt(nf, col.setHex(flowerCols[nf % flowerCols.length]));
          nf++;
        }
      }
      grass.count = ng; flowers.count = nf;
      grass.receiveShadow = true;
      this.grass = grass;
      this.flowers = flowers;
      this.scene.add(grass, flowers);
    }

    setDetail(lvl) {
      this.detail = lvl;
      if (this.grass) this.grass.visible = this.flowers.visible = lvl !== 'low';
      if (this.snow) this.snow.visible = lvl !== 'low';
      this.fogFar = lvl === 'low' ? 320 : 430;
    }

    groundAt(x, z, refY) {
      let h = CW.terrainHeight(x, z);
      for (const b of this.bridges) {
        if (b.y <= h || (refY !== undefined && refY < b.y - 2.2)) continue;
        const along = b.axis === 'x' ? x : z, cross = b.axis === 'x' ? z : x;
        if (along > b.a0 && along < b.a1 && Math.abs(cross - b.c) < b.w) h = b.y;
      }
      return h;
    }

    // Bridges run along x or z. The deck sits at the lower bank's height and
    // extends until it meets land on both sides.
    buildBridges() {
      for (const def of this.arena.bridges) {
        const ax = def.axis;
        const mid = ax === 'x' ? def.x : def.z;
        const c = ax === 'x' ? def.z : def.x;
        const H = (a) => (ax === 'x' ? CW.terrainHeight(a, c) : CW.terrainHeight(c, a));
        const y = Math.min(H(mid - 32), H(mid + 32)) + 0.1;
        let a0 = mid, a1 = mid;
        while (a0 > mid - 60 && H(a0) < y - 0.15) a0 -= 0.5;
        while (a1 < mid + 60 && H(a1) < y - 0.15) a1 += 0.5;
        if (a1 - a0 < 14) continue; // nothing worth bridging here
        a0 -= 2; a1 += 2;
        const P = (a, side) => (ax === 'x' ? new THREE.Vector3(a, y, c + side) : new THREE.Vector3(c + side, y, a));
        const b = { axis: ax, a0, a1, c, w: 3.6, y, mid: P((a0 + a1) / 2, 0), endA: P(a0 - 3, 0), endB: P(a1 + 3, 0) };
        this.bridges.push(b);
        // build along +x, then rotate for z bridges
        const grp = new THREE.Group();
        const len = a1 - a0;
        const wood = this.arena.id === 'isles' ? 0x9fb7c9 : 0xb5651d;
        const rail = this.arena.id === 'isles' ? 0x5d7a91 : 0x7f4f24;
        const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 0.8, b.w * 2), CW.mat(wood));
        deck.position.set(0, -0.4, 0);
        deck.receiveShadow = deck.castShadow = true;
        grp.add(deck);
        for (const side of [-1, 1]) {
          const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.25, 0.25), CW.mat(rail));
          r.position.set(0, 1.0, side * (b.w - 0.15));
          r.castShadow = true;
          grp.add(r);
          for (let px = -len / 2 + 2; px < len / 2 - 1; px += 4) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.1, 0.25), CW.mat(rail));
            post.position.set(px, 0.5, side * (b.w - 0.15));
            grp.add(post);
          }
        }
        for (let px = -len / 2 + 8; px < len / 2 - 6; px += 12) {
          const th = y + 16;
          const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, th, 8), CW.mat(0x8d99ae));
          pil.position.set(px, -0.8 - th / 2, 0);
          pil.castShadow = true;
          grp.add(pil);
        }
        grp.position.copy(b.mid);
        if (ax === 'z') grp.rotation.y = Math.PI / 2;
        this.scene.add(grp);
      }
    }

    buildTerrain() {
      const SIZE = 400, SEG = 200;
      const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const c = new THREE.Color();
      const cA = new THREE.Color(), cB = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const h = CW.terrainHeight(x, z);
        pos.setY(i, h);
        const sx = CW.terrainHeight(x + 1, z) - CW.terrainHeight(x - 1, z);
        const sz = CW.terrainHeight(x, z + 1) - CW.terrainHeight(x, z - 1);
        const slope = Math.hypot(sx, sz) / 2;
        const n = vnoise(x * 0.08, z * 0.08);
        this.arena.color(h, slope, n, c);
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      // smooth shading + a tiled detail texture instead of flat polygons
      const detail = CW.TEX.ground().clone();
      detail.needsUpdate = true;
      detail.repeat.set(70, 70);
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: detail });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      this.terrain = mesh;
      this.scene.add(mesh);
    }

    buildWater() {
      const geo = new THREE.PlaneGeometry(900, 900, 1, 1);
      geo.rotateX(-Math.PI / 2);
      // rippling bump texture, scrolled every frame for a shimmer
      const N = 128;
      const cv = document.createElement('canvas');
      cv.width = cv.height = N;
      const ctx = cv.getContext('2d');
      const img = ctx.createImageData(N, N);
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const v = 128 + 60 * Math.sin((i / N) * Math.PI * 8 + Math.sin((j / N) * Math.PI * 4) * 2) + 40 * (vnoise(i * 0.25, j * 0.25) - 0.5) * 2;
          const k = (j * N + i) * 4;
          img.data[k] = img.data[k + 1] = img.data[k + 2] = v; img.data[k + 3] = 255;
        }
      ctx.putImageData(img, 0, 0);
      const bump = new THREE.CanvasTexture(cv);
      bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
      bump.repeat.set(70, 70);
      this.waterBump = bump;
      this.waterMat = this.arena.liquid === 'lava'
        ? new THREE.MeshPhongMaterial({ color: 0xff5a1a, emissive: 0xd23a00, emissiveMap: bump, shininess: 30, bumpMap: bump, bumpScale: 0.6 }) // glowing lava
        : this.arena.liquid === 'toxic'
          ? new THREE.MeshPhongMaterial({ color: 0x7cff2a, emissive: 0x2f8a00, emissiveMap: bump, transparent: true, opacity: 0.85, shininess: 80, bumpMap: bump, bumpScale: 0.5, depthWrite: false }) // glowing sludge
          : new THREE.MeshPhongMaterial({ color: 0x2e9be6, transparent: true, opacity: 0.75, shininess: 120, specular: 0xd6f0ff, depthWrite: false, bumpMap: bump, bumpScale: 0.35 });
      if (this.arena.liquid) {
        // harmful liquids glow from below
        const glow = new THREE.PointLight(this.arena.liquid === 'lava' ? 0xff5a1a : 0x7cff2a, 1.2, 140, 2);
        glow.position.set(0, 8, 0);
        this.scene.add(glow);
      }
      const water = new THREE.Mesh(geo, this.waterMat);
      water.position.y = CW.WATER_Y;
      water.renderOrder = 2;
      this.water = water;
      this.scene.add(water);
    }

    buildDecor() {
      let seed = 1;
      const rnd = () => hash(seed++, 77);
      this.trees = [];
      this.rocks = [];
      // each arena picks a plant shape: three pieces, each with a geometry and a height offset
      const SHAPES = {
        pine: () => [[new THREE.CylinderGeometry(0.3, 0.45, 2.2, 6), 1.1], [new THREE.ConeGeometry(1.8, 4.5, 7), 4.2], [new THREE.ConeGeometry(1.3, 3.2, 7), 6.3]],
        cactus: () => [[new THREE.CylinderGeometry(0.45, 0.55, 5, 8), 2.5], [new THREE.CylinderGeometry(0.28, 0.28, 2, 8).translate(1, 0, 0), 3.4], [new THREE.CylinderGeometry(0.26, 0.26, 1.6, 8).translate(-0.95, 0, 0), 2.6]],
        palm: () => [[new THREE.CylinderGeometry(0.28, 0.45, 7, 7), 3.5], [new THREE.ConeGeometry(3.4, 1.4, 8), 7.3], [new THREE.SphereGeometry(0.5, 8, 6), 6.6]],
        mushroom: () => [[new THREE.CylinderGeometry(0.45, 0.7, 3.4, 8), 1.7], [new THREE.SphereGeometry(2.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 3.2], [new THREE.SphereGeometry(0.9, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 5.5]],
      };
      const shape = SHAPES[this.arena.trees.shape || 'pine']();
      const maxTrees = this.arena.trees.count === undefined ? 320 : this.arena.trees.count;
      const trunks = new THREE.InstancedMesh(shape[0][0], CW.mat(this.arena.trees.trunk), Math.max(1, maxTrees));
      const leaves = new THREE.InstancedMesh(shape[1][0], CW.mat(this.arena.trees.leaf), Math.max(1, maxTrees));
      const leaves2 = new THREE.InstancedMesh(shape[2][0], CW.mat(this.arena.trees.leaf2), Math.max(1, maxTrees));
      const offs = shape.map((x) => x[1]);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      let n = 0;
      for (let tries = 0; tries < 4000 && n < maxTrees; tries++) {
        const x = (rnd() - 0.5) * 330, z = (rnd() - 0.5) * 330;
        const h = CW.terrainHeight(x, z);
        if (h < 2.2 || h > 24) continue;
        const slope = Math.abs(CW.terrainHeight(x + 1.5, z) - CW.terrainHeight(x - 1.5, z)) + Math.abs(CW.terrainHeight(x, z + 1.5) - CW.terrainHeight(x, z - 1.5));
        if (slope > 1.4) continue;
        if (this.onBridge(x, z, 4.5)) continue;
        if (vnoise(x * 0.025, z * 0.025) < (this.arena.trees.density === undefined ? 0.45 : this.arena.trees.density)) continue;
        const sc = 0.8 + rnd() * 0.7;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6);
        s.set(sc, sc, sc);
        const mats = [];
        p.set(x, h + offs[0] * sc, z); m.compose(p, q, s); trunks.setMatrixAt(n, m); mats.push(m.clone());
        p.set(x, h + offs[1] * sc, z); m.compose(p, q, s); leaves.setMatrixAt(n, m); mats.push(m.clone());
        p.set(x, h + offs[2] * sc, z); m.compose(p, q, s); leaves2.setMatrixAt(n, m); mats.push(m.clone());
        this.trees.push({ x, z, r: 2 * sc, mats, hidden: false });
        n++;
      }
      this.treeMeshes = [trunks, leaves, leaves2];
      for (const im of this.treeMeshes) { im.count = n; im.castShadow = true; im.receiveShadow = true; this.scene.add(im); }

      // rocks
      const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1.2, 0), CW.mat(this.arena.trees.rock, { roughness: 1, metalness: 0 }), 90);
      let r = 0;
      for (let tries = 0; tries < 2000 && r < 90; tries++) {
        const x = (rnd() - 0.5) * 340, z = (rnd() - 0.5) * 340;
        const h = CW.terrainHeight(x, z);
        if (h < -6 || h > 40) continue;
        const sc = 0.6 + rnd() * 1.8;
        q.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3));
        s.set(sc, sc * 0.7, sc);
        p.set(x, h + 0.2, z); m.compose(p, q, s); rocks.setMatrixAt(r++, m);
        this.rocks.push({ x, y: h + 0.2, z, r: sc * 1.3, mat: m.clone(), hidden: false });
      }
      rocks.count = r; rocks.castShadow = true; rocks.receiveShadow = true;
      this.rockMesh = rocks;
      this.scene.add(rocks);

      // glowing crystals on the mountain (discovery flavor)
      const crystalGeo = new THREE.OctahedronGeometry(1, 0);
      const cc = this.arena.crystalColors || (this.arena.lava ? [[0xff7a1a, 0xc23a00], [0xffd23f, 0xa06000]] : [[0xff5cf0, 0x8a1a80], [0x5cf2ff, 0x177f8a]]);
      const crystalMats = cc.map(([c, e]) => CW.mat(c, { emissive: e }));
      if (this.arena.neon) this.buildNeon(rnd);
      if (this.arena.scrap) this.buildScrap(rnd);
      for (let i = 0; i < (this.arena.neon ? 0 : 26); i++) {
        const a = rnd() * Math.PI * 2, d = 10 + rnd() * 40;
        const x = this.arena.crystals.x + Math.cos(a) * d, z = this.arena.crystals.z + Math.sin(a) * d;
        const h = CW.terrainHeight(x, z);
        const c = new THREE.Mesh(crystalGeo, crystalMats[i % 2]);
        const sc = 0.8 + rnd() * 1.6;
        c.scale.set(sc * 0.6, sc * 1.8, sc * 0.6);
        c.position.set(x, h + sc, z);
        c.rotation.set(rnd() * 0.4, rnd() * 3, rnd() * 0.4);
        c.castShadow = true;
        this.scene.add(c);
      }
    }

    // Scrap Yard: wrecked car hulks, tire stacks and two cranes over the rail
    buildScrap(rnd) {
      const rust = [0x8a4b2a, 0x6b7078, 0x3a6ea5, 0xa83232, 0xc9a227, 0x4a6b3a].map((c) => CW.mat(c, { metalness: 0.5, roughness: 0.7 }));
      const dark = CW.mat(0x222222, { roughness: 0.9 });
      const hull = new THREE.BoxGeometry(4.2, 1.6, 2.2), cab = new THREE.BoxGeometry(2.2, 1.1, 2), tire = new THREE.TorusGeometry(0.75, 0.32, 8, 16);
      for (let i = 0; i < 70; i++) {
        const x = (rnd() - 0.5) * 300, z = (rnd() - 0.5) * 300;
        const h = CW.terrainHeight(x, z);
        if (h < 0.5 || Math.hypot(x, z) < 34) continue;
        const g = new THREE.Group();
        if (i % 3) {
          const m = rust[i % rust.length];
          const b = new THREE.Mesh(hull, m), t = new THREE.Mesh(cab, m);
          t.position.set(-0.3, 1.3, 0);
          g.add(b, t);
          g.rotation.set((rnd() - 0.5) * 0.5, rnd() * 6.3, (rnd() - 0.5) * (i % 5 === 0 ? 3 : 0.5));
        } else {
          for (let k = 0; k < 2 + (i % 3); k++) { const t = new THREE.Mesh(tire, dark); t.rotation.x = Math.PI / 2; t.position.y = 0.32 + k * 0.62; g.add(t); }
        }
        g.position.set(x, h + 0.6, z);
        g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        this.scene.add(g);
      }
      const steel = CW.mat(0xffb000, { metalness: 0.6, roughness: 0.5 });
      for (const x of [-60, 70]) {
        const g = new THREE.Group();
        const tower = new THREE.Mesh(new THREE.BoxGeometry(2.4, 34, 2.4), steel);
        tower.position.y = 17;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(30, 1.6, 1.6), steel);
        arm.position.set(10, 33, 0);
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 14, 4), dark);
        cable.position.set(22, 26, 0);
        const magnet = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.8, 16), dark);
        magnet.position.set(22, 19, 0);
        g.add(tower, arm, cable, magnet);
        g.position.set(x, CW.terrainHeight(x, -26), -26);
        g.rotation.y = x < 0 ? 0.6 : 2.4;
        g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        this.scene.add(g);
      }
    }

    // Neon City: glowing strips along rooftop edges and tall signs on building sides
    buildNeon(rnd) {
      const cols = [0xff4fd8, 0x4cc9f0, 0xffd23f, 0x7cff6a, 0xff6b35];
      const half = 11;
      for (let ix = -4; ix <= 4; ix++) for (let iz = -4; iz <= 4; iz++) {
        const cx = ix * 34, cz = iz * 34;
        if (Math.max(Math.abs(cx), Math.abs(cz)) > 150) continue;
        const top = CW.terrainHeight(cx, cz);
        if (top < 8) continue;
        const mat = new THREE.MeshBasicMaterial({ color: cols[Math.floor(rnd() * cols.length)] });
        for (const [sx, sz, rot] of [[0, -half, 0], [0, half, 0], [-half, 0, 1], [half, 0, 1]]) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(half * 2 - 1, 0.35, 0.35), mat);
          bar.position.set(cx + sx, top + 0.2, cz + sz);
          if (rot) bar.rotation.y = Math.PI / 2;
          this.scene.add(bar);
        }
        if (rnd() < 0.5) { // a vertical sign
          const sign = new THREE.Mesh(new THREE.BoxGeometry(0.4, Math.min(10, top - 5), 2.4), new THREE.MeshBasicMaterial({ color: cols[Math.floor(rnd() * cols.length)] }));
          sign.position.set(cx + half + 0.4, 3 + (top - 3) / 2, cz);
          this.scene.add(sign);
        }
      }
      // street lights along the main avenues
      const lamp = CW.mat(0x343a40);
      const bulb = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
      for (let i = -4; i <= 4; i++) for (const off of [-17, 17]) {
        const x = i * 34 + 17, z = off;
        if (Math.abs(x) > 150) continue;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 6, 6), lamp);
        pole.position.set(x, 6, z);
        this.scene.add(pole);
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), bulb);
        b.position.set(x, 9.1, z);
        this.scene.add(b);
      }
    }

    buildClouds() {
      this.clouds = [];
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x666666 });
      const geo = new THREE.IcosahedronGeometry(1, 1);
      for (let i = 0; i < 16; i++) {
        const g = new THREE.Group();
        const n = 4 + Math.floor(hash(i, 3) * 4);
        for (let j = 0; j < n; j++) {
          const m = new THREE.Mesh(geo, mat);
          const s = 5 + hash(i, j) * 6;
          m.scale.set(s, s * 0.6, s);
          m.position.set((j - n / 2) * 6, hash(j, i) * 3, hash(i + 9, j) * 6);
          g.add(m);
        }
        g.position.set((hash(i, 1) - 0.5) * 500, 75 + hash(i, 2) * 30, (hash(i, 5) - 0.5) * 500);
        this.clouds.push(g);
        this.scene.add(g);
      }
    }

    // Hide trees that sit between the camera and what it's looking at
    updateOcclusion(cam, pivot) {
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      const ax = cam.x, az = cam.z, bx = pivot ? pivot.x : cam.x, bz = pivot ? pivot.z : cam.z;
      const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1e-6;
      let dirty = false;
      for (let i = 0; i < this.trees.length; i++) {
        const t = this.trees[i];
        let hide = false;
        if (pivot && Math.abs(t.x - ax) < 30 && Math.abs(t.z - az) < 30) {
          const u = Math.max(0, Math.min(1, ((t.x - ax) * dx + (t.z - az) * dz) / len2));
          const px = ax + dx * u - t.x, pz = az + dz * u - t.z;
          hide = px * px + pz * pz < (t.r + 1.2) * (t.r + 1.2);
        }
        if (hide !== t.hidden) {
          t.hidden = hide;
          this.treeMeshes.forEach((im, k) => im.setMatrixAt(i, hide ? zero : t.mats[k]));
          dirty = true;
        }
      }
      if (dirty) for (const im of this.treeMeshes) im.instanceMatrix.needsUpdate = true;
      // rocks: hide when the camera is inside one or it sits between camera and target
      let rDirty = false;
      for (let i = 0; i < this.rocks.length; i++) {
        const rk = this.rocks[i];
        let hide = false;
        if (Math.abs(rk.x - ax) < 30 && Math.abs(rk.z - az) < 30) {
          if (Math.hypot(rk.x - ax, rk.y - cam.y, rk.z - az) < rk.r + 1.2) hide = true;
          else if (pivot) {
            const u = Math.max(0, Math.min(1, ((rk.x - ax) * dx + (rk.z - az) * dz) / len2));
            const px = ax + dx * u - rk.x, pz = az + dz * u - rk.z;
            hide = px * px + pz * pz < (rk.r + 0.8) * (rk.r + 0.8) && rk.y + rk.r > Math.min(cam.y, pivot.y) - 1;
          }
        }
        if (hide !== rk.hidden) { rk.hidden = hide; this.rockMesh.setMatrixAt(i, hide ? zero : rk.mat); rDirty = true; }
      }
      if (rDirty) this.rockMesh.instanceMatrix.needsUpdate = true;
    }

    update(dt, cam) {
      this.t = (this.t || 0) + dt;
      this.updateSnow(dt, cam);
      if (this.waterBump) { this.waterBump.offset.x += dt * 0.02; this.waterBump.offset.y += dt * 0.013; }
      for (const c of this.clouds) {
        c.position.x += dt * 2.5;
        if (c.position.x > 280) c.position.x = -280;
      }
    }

    // A spot is safe to spawn on when it's dry, fairly flat, not on a bridge, away from the walls,
    // and there is no liquid (water / lava / toxic) anywhere close by.
    isSafeSpot(x, z) {
      if (Math.max(Math.abs(x), Math.abs(z)) > CW.ARENA_HALF - 18) return false;
      const h = CW.terrainHeight(x, z);
      if (h < 2.5 || h > 40) return false;
      if (this.onBridge(x, z, 6)) return false;
      const slope = Math.abs(CW.terrainHeight(x + 3, z) - CW.terrainHeight(x - 3, z)) + Math.abs(CW.terrainHeight(x, z + 3) - CW.terrainHeight(x, z - 3));
      if (slope > 2.2) return false;
      for (const r of [5, 10, 16]) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
          if (CW.terrainHeight(x + Math.cos(a) * r, z + Math.sin(a) * r) < 1) return false;
        }
      }
      return true;
    }

    computeSpawns() {
      this.landSpawns = [];
      this.waterSpawns = [];
      for (let a = 0; a < Math.PI * 2; a += 0.18) {
        for (const r of [140, 120, 100, 80, 60]) {
          const x = Math.cos(a) * r, z = Math.sin(a) * r;
          if (this.isSafeSpot(x, z)) { this.landSpawns.push(new THREE.Vector3(x, CW.terrainHeight(x, z), z)); break; }
        }
      }
      // maps with lots of liquid: fill up with a grid search
      for (let x = -150; x <= 150 && this.landSpawns.length < 16; x += 15)
        for (let z = -150; z <= 150 && this.landSpawns.length < 16; z += 15) {
          if (this.isSafeSpot(x, z) && this.landSpawns.every((s) => Math.hypot(s.x - x, s.z - z) > 25)) this.landSpawns.push(new THREE.Vector3(x, CW.terrainHeight(x, z), z));
        }
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2, r = 12 + (i % 3) * 8;
        const x = this.arena.waterCenter.x + Math.cos(a) * r, z = this.arena.waterCenter.z + Math.sin(a) * r;
        if (CW.terrainHeight(x, z) < -5) this.waterSpawns.push(new THREE.Vector3(x, 0, z));
      }
    }

    buildMinimap() {
      const tmpC = new THREE.Color();
      const N = 128;
      const cv = document.createElement('canvas');
      cv.width = cv.height = N;
      const ctx = cv.getContext('2d');
      const img = ctx.createImageData(N, N);
      const R = 190;
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const x = (i / N - 0.5) * 2 * R, z = (j / N - 0.5) * 2 * R;
          const h = this.groundAt(x, z);
          let col;
          if (this.onBridge(x, z, 1)) col = [181, 101, 29];
          else if (h < 0) col = [46 + h * 2, 140 + h * 3, 220 + h * 2];
          else {
            const c = this.arena.color(h, 0, 0.5, tmpC);
            col = [c.r * 230, c.g * 230, c.b * 230];
          }
          const k = (j * N + i) * 4;
          img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
        }
      ctx.putImageData(img, 0, 0);
      this.minimap = cv;
      this.minimapRange = R;
    }
  }

  CW.World = World;
})();
