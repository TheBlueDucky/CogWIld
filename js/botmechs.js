// Cogwild — bots build their own mechs (v1.10.1): instead of the same few example mechs, every bot gets a mech built
// for it from a plan (car, monster truck, rammer, walker, helicopter, plane or boat) with its own mix of weapons, armor,
// utility parts and looks, sized to the budget. Each plan is checked like a player's mech (CW.validate) and has to
// actually move (drive, hover, take off or float); if it doesn't, the bot gets a varied example mech instead.
(function () {
  const CW = window.CW;
  const ADJ = ['Iron', 'Rusty', 'Neon', 'Turbo', 'Mega', 'Shadow', 'Steel', 'Thunder', 'Savage', 'Hyper', 'Atomic', 'Crimson', 'Frost', 'Scrap', 'Rocket', 'Venom', 'Chrome', 'Wild'];
  const NOUN = { car: ['Viper', 'Racer', 'Stinger', 'Jackal', 'Bandit'], truck: ['Crusher', 'Goliath', 'Bulldog', 'Mammoth'], rammer: ['Rhino', 'Ram', 'Hammer', 'Battering Ram'],
    walker: ['Mantis', 'Spider', 'Scorpion', 'Beetle'], heli: ['Hornet', 'Wasp', 'Dragonfly', 'Gunship'], plane: ['Falcon', 'Raptor', 'Jet', 'Swift'], boat: ['Shark', 'Kraken', 'Barracuda'] };
  const GUNS = ['cannon', 'cannon', 'rocket', 'laser', 'railgun', 'flamer', 'mortar', 'harpoon', 'tesla', 'magnet'];

  function builder() {
    const parts = [], at = new Map();
    const key = (x, y, z) => x + ',' + y + ',' + z;
    const b = {
      parts,
      has: (x, y, z) => at.has(key(x, y, z)),
      get: (x, y, z) => at.get(key(x, y, z)),
      put(t, x, y, z) {
        if (Math.abs(x) > 4 || Math.abs(z) > 4 || y < -2 || y > 4 || at.has(key(x, y, z))) return false;
        const p = { t, x, y, z };
        parts.push(p); at.set(key(x, y, z), p);
        return true;
      },
      set(t, x, y, z) { const p = at.get(key(x, y, z)); if (p) { p.t = t; return true; } return b.put(t, x, y, z); },
      remove(p) { parts.splice(parts.indexOf(p), 1); at.delete(key(p.x, p.y, p.z)); },
      // a free spot on top of the mech touching what's there (not in front of the camera)
      spot(rnd, minY = 1) {
        const cam = parts.find((p) => p.t === 'camera');
        const free = [];
        for (const p of parts) {
          for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1]]) {
            const x = p.x + dx, y = p.y + dy, z = p.z + dz;
            if (y < minY || Math.abs(x) > 4 || Math.abs(z) > 4 || y > 4 || at.has(key(x, y, z))) continue;
            if (cam && x === cam.x && y === cam.y && z < cam.z) continue;
            if (CW.PARTS[p.t].weapon || ['rotor', 'wing', 'jet', 'camera', 'flag', 'lamp', 'horn', 'spoiler', 'exhaust', 'lights', 'prop'].includes(p.t)) continue; // only on solid parts
            free.push([x, y, z]);
          }
        }
        return free.length ? free[Math.floor(rnd() * free.length)] : null;
      },
    };
    return b;
  }

  const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];

  // the plans: each lays out a body, how it moves, the camera and spots for weapons
  const PLANS = {
    car(b, rnd, big) {
      const wide = big || rnd() < 0.6, L = 3 + Math.floor(rnd() * 2) + (big ? 1 : 0);
      const zf = -Math.floor(L / 2), zb = zf + L - 1, wx = wide ? 2 : 1, wheel = big ? 'bigwheel' : 'wheel';
      for (let z = zf; z <= zb; z++) for (let x = wide ? -1 : 0; x <= (wide ? 1 : 0); x++) b.put(x === 0 && z === 0 ? 'core' : x === 0 ? 'body' : rnd() < 0.5 ? 'body' : 'frame', x, 0, z);
      const rows = L >= 5 ? [zf, 0, zb] : [zf, zb];
      for (const z of rows) for (const s of [-1, 1]) { b.put(wheel, s * wx, 0, z); if (!big && rnd() < 0.7) b.put('fender', s * wx, 1, z); }
      b.put('nose', 0, 0, zf - 1);
      if (wide && rnd() < 0.6) { b.put('lights', -1, 0, zf - 1); b.put('lights', 1, 0, zf - 1); }
      b.put(rnd() < 0.5 ? 'exhaust' : 'booster', 0, 0, zb + 1);
      b.put('camera', 0, 1, zf);
      b.put('cabin', 0, 1, zf + 1);
      return { guns: wide ? [[-1, 1, 0], [1, 1, 0], [0, 2, zf + 1]] : [[-1, 1, 0], [1, 1, 0], [0, 2, zf + 1]], back: [0, 1, zb] };
    },
    truck(b, rnd) { return PLANS.car(b, rnd, true); },
    rammer(b, rnd) {
      const r = PLANS.car(b, rnd, rnd() < 0.4);
      const front = Math.min(...b.parts.map((p) => p.z));
      for (const p of b.parts.filter((q) => q.y === 0 && q.z === front)) if (!['wheel', 'bigwheel'].includes(p.t)) p.t = 'spikes';
      for (const x of [-1, 0, 1]) if (!b.has(x, 0, front - 1) && b.has(x, 0, front)) b.put('spikes', x, 0, front - 1);
      const wx = Math.max(...b.parts.filter((p) => p.t === 'wheel' || p.t === 'bigwheel').map((p) => p.x));
      if (rnd() < 0.7) for (const s of [-1, 1]) b.put('saw', s * (wx + 1), 0, 0);
      const back = Math.max(...b.parts.map((p) => p.z));
      for (const x of [-1, 1]) b.put('booster', x, 0, back + (b.has(x, 0, back) ? 1 : 0));
      r.guns = r.guns.slice(0, 1);
      return r;
    },
    walker(b, rnd) {
      const six = rnd() < 0.4;
      for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) b.put(x === 0 && z === 0 ? 'core' : rnd() < 0.5 ? 'armor' : 'frame', x, 0, z);
      for (const z of six ? [-1, 0, 1] : [-1, 1]) for (const s of [-1, 1]) b.put('leg', s * 2, 0, z);
      b.put('camera', 0, 1, -1);
      b.put('engine', 0, 1, 1);
      return { guns: [[-1, 1, 0], [1, 1, 0], [0, 2, 0], [-1, 1, -1], [1, 1, -1]], back: [0, 1, 0] };
    },
    heli(b, rnd) {
      b.put('core', 0, 0, 0);
      for (const [x, z] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) b.put('frame', x, 0, z);
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.put('rotor', x, 0, z);
      b.put('camera', 0, 1, -1);
      if (rnd() < 0.5) b.put('jet', 0, 0, 2);
      return { guns: [[0, -1, 0], [0, -1, -1], [0, 1, 0]], back: [0, 1, 1], light: true };
    },
    plane(b, rnd) {
      for (const z of [-1, 0, 1]) b.put(z === 0 ? 'core' : 'frame', 0, 0, z);
      b.put('nose', 0, 0, -2);
      for (const x of [-1, 1, -2, 2]) b.put('wing', x, 0, 0);
      if (rnd() < 0.5) for (const x of [-1, 1]) b.put('wing', x, 0, 1);
      for (const x of [-1, 1]) b.put('jet', x, 0, 2 - (b.has(x, 0, 1) ? 0 : 1));
      b.put('spoiler', 0, 1, 1);
      b.put('wheel', 0, -1, -1); b.put('wheel', 0, -1, 1);
      b.put('camera', 0, 1, -1);
      return { guns: [[0, 1, 0], [-1, -1, 0], [1, -1, 0]], back: [0, 1, 0], light: true };
    },
    boat(b, rnd) {
      for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) b.put(x === 0 && z === 0 ? 'core' : x === 0 ? 'frame' : 'float', x, 0, z);
      for (const s of [-1, 1]) b.put('float', s * 2, 0, 0);
      for (const x of [-1, 1]) b.put('prop', x, 0, 2);
      b.put('nose', 0, 0, -2);
      b.put('camera', 0, 1, -1);
      return { guns: [[0, 1, 0], [-1, 1, 0], [1, 1, 0], [0, 1, 1]], back: [0, 1, 1] };
    },
  };
  const AI = { car: 'ground', truck: 'ground', rammer: 'rammer', walker: 'ground', heli: 'heli', plane: 'plane', boat: 'boat' };

  // one mech for a bot: { name, parts, ai } (or null if this plan didn't work out)
  CW.genBotMech = function (budget, domains, opts = {}) {
    const rnd = opts.rnd || Math.random;
    const kinds = ['car', 'car', 'truck', 'truck', 'rammer', 'walker', 'walker', 'heli', 'heli', 'plane'].concat(opts.noBoats ? [] : ['boat']);
    const kind = opts.kind || pick(rnd, kinds);
    const b = builder();
    const plan = PLANS[kind](b, rnd);
    // weapons: a theme (one kind, or a mix), on the plan's spots
    const theme = rnd() < 0.45 ? [pick(rnd, GUNS)] : [pick(rnd, GUNS), pick(rnd, GUNS), pick(rnd, GUNS)];
    const nGuns = plan.light ? 2 : 2 + Math.floor(rnd() * 2);
    for (const [x, y, z] of plan.guns.slice(0, nGuns)) {
      if (y > 0 && !b.has(x, y - 1, z)) b.put(plan.light ? 'frame' : 'armor', x, y - 1, z); // something to stand on
      b.put(pick(rnd, theme), x, y, z);
    }
    // utility and looks
    const extras = plan.light ? ['engine', 'engine', 'shield', 'booster', 'flag'] : ['armor', 'armor', 'armor', 'engine', 'shield', 'booster', 'drone', 'armor', 'flag', 'horn', 'lamp', 'plate'];
    const nExtra = plan.light ? 2 : 3 + Math.floor(rnd() * 6);
    for (let i = 0; i < nExtra; i++) { const s = b.spot(rnd); if (s) b.put(pick(rnd, extras), ...s); }
    // enough power for everything (engines), within the budget
    for (let i = 0; i < 4; i++) {
      const s = CW.analyze(b.parts);
      if (s.pr >= 0.95) break;
      const sp = b.spot(rnd);
      if (!sp) break;
      b.put('engine', ...sp);
    }
    const trim = ['flag', 'horn', 'lamp', 'plate', 'fender', 'lights', 'drone', 'armor', 'shield'];
    for (let i = 0; i < 60 && CW.analyze(b.parts).cost > budget; i++) {
      const p = trim.map((t) => b.parts.filter((q) => q.t === t).pop()).find(Boolean) || b.parts.filter((q) => CW.PARTS[q.t].weapon).pop();
      if (!p) break;
      b.remove(p);
    }
    let parts = CW.connected ? CW.connected(b.parts) : b.parts;
    parts = parts.map((p) => ({ t: p.t, x: p.x, y: p.y, z: p.z }));
    const v = CW.validate(parts, domains || 3, budget);
    if (!v.ok) return null;
    const s = v.s;
    const moves = kind === 'heli' ? s.hovers : kind === 'plane' ? s.planeFlies : kind === 'boat' ? s.floats && s.swim > 0 : s.drive > 0 && s.pr >= 0.7;
    if (!moves || !(s.weapons > 0 || s.spikes > 0)) return null;
    return { name: `${pick(rnd, ADJ)} ${pick(rnd, NOUN[kind])}`, parts, ai: AI[kind], gen: kind };
  };
  // a few tries, then a varied example mech
  CW.botMech = function (budget, domains, opts = {}) {
    for (let i = 0; i < 6; i++) { const m = CW.genBotMech(budget, domains, opts); if (m) return m; }
    return null;
  };
})();
