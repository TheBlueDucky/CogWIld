// Cogwild — the economy, the same for the game (window.CW) and the server (require), so both always agree:
// the Shop, daily deals, the Trophy Road, the daily gift, the Cog Pass season, weekly events and Ranked.
// For logged-in players the server owns coins and unlocks (server/accounts.js); the game shows them and asks.
(function (root) {
  const DAY = 86400000;
  const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
  function seeded(seedStr) {
    let h = hash(seedStr) | 0;
    return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  }
  // days change at midnight UTC, for every player in the world at once
  const day = (now) => new Date(now || Date.now()).toISOString().slice(0, 10);
  const nextMidnight = (now) => { const t = new Date(now || Date.now()); return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1); };

  const SHOP = {
    paints: [
      { id: 'gold', name: 'Gold Rush', color: 0xffd23f, price: 300 },
      { id: 'neon', name: 'Neon Pink', color: 0xff4fd8, price: 200 },
      { id: 'lime', name: 'Toxic Lime', color: 0xa7ff3c, price: 200 },
      { id: 'night', name: 'Midnight', color: 0x2b2f5c, price: 250 },
      { id: 'lava', name: 'Lava', color: 0xff4500, price: 250 },
      { id: 'ice', name: 'Ice', color: 0x9be7ff, price: 200 },
      { id: 'mint', name: 'Mint', color: 0x7dffc4, price: 150 },
      { id: 'coal', name: 'Coal', color: 0x222222, price: 150 },
      { id: 'chrome', name: 'Chrome', color: 0xc0c6cc, price: 350 },
      { id: 'royal', name: 'Royal Purple', color: 0x5a189a, price: 250 },
      { id: 'camo', name: 'Camo Green', color: 0x556b2f, price: 200 },
      { id: 'sakura', name: 'Sakura', color: 0xffb7c5, price: 250 },
      { id: 'ruby', name: 'Ruby', color: 0xc1121f, price: 250 },
      { id: 'ocean', name: 'Ocean', color: 0x0077b6, price: 200 },
      { id: 'sunset', name: 'Sunset', color: 0xff7b54, price: 200 },
      { id: 'grape', name: 'Grape', color: 0x7b2cbf, price: 200 },
      { id: 'sand', name: 'Desert Sand', color: 0xe9c46a, price: 150 },
      { id: 'forest', name: 'Forest', color: 0x2d6a4f, price: 150 },
      { id: 'snow', name: 'Snow White', color: 0xf1f5ff, price: 200 },
      { id: 'cyber', name: 'Cyber Teal', color: 0x00f5d4, price: 300 },
      { id: 'bronze', name: 'Bronze', color: 0xb5651d, price: 300 },
      { id: 'magenta', name: 'Hot Magenta', color: 0xff006e, price: 250 },
      { id: 'steel', name: 'Gunmetal', color: 0x4a4e69, price: 250 },
      { id: 'banana', name: 'Banana', color: 0xffe74c, price: 150 },
      // Cog Pass only (never sold): `pass: true`
      { id: 'p_aurora', name: 'Aurora', color: 0x5ef2c6, price: 400, pass: true },
      { id: 'p_obsidian', name: 'Obsidian', color: 0x1b1033, price: 400, pass: true },
      { id: 'p_solar', name: 'Solar Flare', color: 0xff9e00, price: 400, pass: true },
      { id: 'p_glacier', name: 'Glacier', color: 0x8ecae6, price: 400, pass: true },
      { id: 'p_venom', name: 'Venom', color: 0x7fff00, price: 400, pass: true },
      { id: 'p_rose', name: 'Rose Gold', color: 0xe8a39b, price: 400, pass: true },
      { id: 'p_cobalt', name: 'Cobalt', color: 0x0047ab, price: 400, pass: true },
      { id: 'p_ember', name: 'Ember Red', color: 0x9d0208, price: 400, pass: true },
      // seasonal events only (never sold)
      { id: 'ev_pumpkin', name: 'Pumpkin Spice', color: 0xff7518, price: 400, event: 'halloween' },
      { id: 'ev_frost', name: 'Frosty Blue', color: 0xa8e6ff, price: 400, event: 'winter' },
      { id: 'ev_rose', name: 'Valentine Red', color: 0xe5383b, price: 400, event: 'love' },
      { id: 'ev_blossom', name: 'Cherry Blossom', color: 0xffb7d5, price: 400, event: 'spring' },
      { id: 'ev_tropic', name: 'Tropical', color: 0x00c2a8, price: 400, event: 'summer' },
    ],
    trails: [
      { id: 'spark', name: 'Sparks', colors: [0xffe066], price: 0 },
      { id: 'fire', name: 'Fire', colors: [0xff6b1a, 0xffb700, 0xff3d00], price: 250 },
      { id: 'ice', name: 'Frost', colors: [0x9be7ff, 0xffffff, 0x5cc8ff], price: 250 },
      { id: 'toxic', name: 'Toxic', colors: [0x7cff4f, 0xb6ff00, 0x2ee86a], price: 250 },
      { id: 'void', name: 'Void', colors: [0x7b2cff, 0x2b0a5c, 0xc77dff], price: 350 },
      { id: 'rainbow', name: 'Rainbow', colors: [0xff595e, 0xffca3a, 0x8ac926, 0x1982c4, 0x6a4c93], price: 500 },
      { id: 'gold', name: 'Gold Dust', colors: [0xffd23f, 0xfff3b0, 0xc9a227], price: 400 },
      { id: 'neon', name: 'Neon', colors: [0xff4fd8, 0x4cc9f0], price: 350 },
      { id: 'ocean', name: 'Ocean Spray', colors: [0x48cae4, 0x0096c7, 0xcaf0f8], price: 300 },
      { id: 'candy', name: 'Candy', colors: [0xff8fab, 0xffffff, 0xff4d6d], price: 300 },
      { id: 'ember', name: 'Embers', colors: [0xff5400, 0x2b2d42, 0xffbd00], price: 350 },
      { id: 'galaxy', name: 'Galaxy', colors: [0x3a0ca3, 0x7209b7, 0xf72585, 0x4cc9f0], price: 450 },
      { id: 'lime', name: 'Electric Lime', colors: [0xccff33, 0x70e000], price: 300 },
      { id: 'shadow', name: 'Shadow', colors: [0x111111, 0x3d3d3d, 0x6c757d], price: 400 },
      { id: 'p_plasma', name: 'Plasma', colors: [0x00f0ff, 0xb5179e, 0xffffff], price: 500, pass: true },
      { id: 'p_lightning', name: 'Lightning', colors: [0xfff200, 0xffffff, 0x4cc9f0], price: 500, pass: true },
      { id: 'p_sakura', name: 'Petals', colors: [0xffb7c5, 0xffe5ec, 0xff8fab], price: 500, pass: true },
      { id: 'p_matrix', name: 'Code Rain', colors: [0x00ff41, 0x008f11, 0x003b00], price: 500, pass: true },
      { id: 'p_inferno', name: 'Inferno', colors: [0xff0000, 0xff7b00, 0xffd000, 0x1a1a1a], price: 500, pass: true },
      // seasonal events only (never sold)
      { id: 'ev_spooky', name: 'Spooky Mist', colors: [0xff7518, 0x7b2cbf, 0x1a1a1a], price: 500, event: 'halloween' },
      { id: 'ev_snowflake', name: 'Snowflakes', colors: [0xffffff, 0xbfe9ff, 0x8ecae6], price: 500, event: 'winter' },
      { id: 'ev_love', name: 'Love Trail', colors: [0xff4d6d, 0xffb3c6, 0xffffff], price: 500, event: 'love' },
      { id: 'ev_bloom', name: 'Spring Breeze', colors: [0xffc8dd, 0xffafcc, 0xcdb4db, 0xb9fbc0], price: 500, event: 'spring' },
      { id: 'ev_wave', name: 'Ocean Wave', colors: [0x00b4d8, 0x90e0ef, 0xffffff], price: 500, event: 'summer' },
      { id: 'cup_champ', name: 'Champion', colors: [0xffd700, 0xfff3b0, 0xffffff, 0xffb000], price: 800, event: 'cup' }, // Weekend Cup top 3 only
    ],
    // finishes: how your whole mech's paint looks in matches, the Workshop and the lobby (js/parts.js CW.finishMat)
    finishes: [
      { id: 'carbon', name: 'Carbon Fiber', icon: '🏁', desc: 'Woven racing carbon in your paint color', price: 500 },
      { id: 'stealth', name: 'Stealth Matte', icon: '🥷', desc: 'Flat dark armor that swallows the light', price: 500 },
      { id: 'chrome', name: 'Mirror Chrome', icon: '🪞', desc: 'Polished chrome that reflects the arena', price: 700 },
      { id: 'neon', name: 'Neon Glow', icon: '💡', desc: 'Your paint glows, even at night', price: 800 },
      { id: 'gold', name: 'Gold Plated', icon: '👑', desc: 'Solid shining gold, whatever your paint', price: 1000 },
      { id: 'rainbow', name: 'Rainbow Shift', icon: '🌈', desc: 'Colors that flow through the whole rainbow', price: 1400 },
    ],
    // wreck effects: what you see when you wreck an enemy mech (js/entities.js Fx.wreckFx)
    wrecks: [
      { id: 'confetti', name: 'Confetti Pop', icon: '🎊', desc: 'Wrecks burst into confetti', price: 400 },
      { id: 'pixel', name: 'Pixel Burst', icon: '👾', desc: 'Wrecks shatter into glowing pixels', price: 500 },
      { id: 'fireworks', name: 'Fireworks', icon: '🎆', desc: 'A fireworks show over every wreck', price: 700 },
      { id: 'lightning', name: 'Thunderstrike', icon: '⚡', desc: 'Lightning strikes the wreck from the sky', price: 800 },
      { id: 'blackhole', name: 'Black Hole', icon: '🕳', desc: 'The wreck is sucked into a black hole', price: 1100 },
      // seasonal events only (never sold): `event: <event id>`
      { id: 'ev_bats', name: 'Bat Swarm', icon: '🦇', desc: 'Wrecks burst into a swarm of bats', price: 600, event: 'halloween' },
      { id: 'ev_snow', name: 'Snow Globe', icon: '❄', desc: 'Wrecks burst into a snowstorm', price: 600, event: 'winter' },
      { id: 'ev_hearts', name: 'Heart Burst', icon: '💘', desc: 'Wrecks burst into hearts', price: 600, event: 'love' },
      { id: 'ev_petals', name: 'Petal Storm', icon: '🌸', desc: 'Wrecks burst into blossom petals', price: 600, event: 'spring' },
      { id: 'ev_splash', name: 'Big Splash', icon: '🌊', desc: 'Wrecks burst into a splash of water', price: 600, event: 'summer' },
    ],
    // premium avatars (CW.AVATARS index 24+), shown on your profile, in rooms and on the leaderboard
    avatars: [
      { id: 'av24', idx: 24, name: 'Dragon', price: 400 }, { id: 'av25', idx: 25, name: 'Eagle', price: 250 }, { id: 'av26', idx: 26, name: 'Scorpion', price: 250 },
      { id: 'av27', idx: 27, name: 'Croc', price: 250 }, { id: 'av28', idx: 28, name: 'Gorilla', price: 300 }, { id: 'av29', idx: 29, name: 'Zebra', price: 200 },
      { id: 'av30', idx: 30, name: 'Flamingo', price: 200 }, { id: 'av31', idx: 31, name: 'Peacock', price: 300 }, { id: 'av32', idx: 32, name: 'Whale', price: 300 },
      { id: 'av33', idx: 33, name: 'Squid', price: 250 }, { id: 'av34', idx: 34, name: 'Ladybug', price: 200 }, { id: 'av35', idx: 35, name: 'Hedgehog', price: 250 },
      { id: 'av36', idx: 36, name: 'Cowboy', price: 350 }, { id: 'av37', idx: 37, name: 'Ninja', price: 400 }, { id: 'av38', idx: 38, name: 'Wizard', price: 400 },
      { id: 'av39', idx: 39, name: 'Royal', price: 600 },
      { id: 'av40', idx: 40, name: 'UFO', price: 500, pass: true }, { id: 'av41', idx: 41, name: 'Cyborg', price: 500, pass: true },
      { id: 'av42', idx: 42, name: 'Volt', price: 500, pass: true }, { id: 'av43', idx: 43, name: 'Eruption', price: 500, pass: true },
      { id: 'av44', idx: 44, name: 'Planet', price: 500, pass: true }, { id: 'av45', idx: 45, name: 'Pirate', price: 500, pass: true },
      { id: 'av46', idx: 46, name: 'Ice Cube', price: 500, pass: true }, { id: 'av47', idx: 47, name: 'Bullseye', price: 500, pass: true },
    ],
  };
  const AVATAR_COUNT = 48, FREE_AVATARS = 24;
  const item = (kind, id) => (SHOP[kind] || []).find((x) => x.id === id) || null;
  const dealPrice = (it) => Math.max(10, Math.round((it.price * 0.7) / 10) * 10);
  // 3 things you don't own yet at 30% off, the same for everyone each day
  function dailyDeals(dayStr, owns) {
    const rnd = seeded('deal' + dayStr);
    const pool = [];
    for (const kind of ['paints', 'trails', 'avatars', 'finishes', 'wrecks']) for (const it of SHOP[kind]) if (!it.pass && !it.event && it.price > 0 && !owns(kind, it.id)) pool.push({ kind, it });
    pool.sort((a, b) => (a.kind + a.it.id < b.kind + b.it.id ? -1 : 1));
    const out = [];
    while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    return out;
  }

  // Trophy Road: ~80 rewards from 10 to 10,000 trophies (your best ever counts, so losing trophies never
  // takes them away). Coins in between, and every paint, trail and avatar from the Shop along the way.
  const ROAD = (() => {
    const marks = [10, 25, 50, 75, 100];
    const add = (to, step) => { while (marks[marks.length - 1] + step <= to) marks.push(marks[marks.length - 1] + step); };
    add(500, 25); add(1500, 50); add(3000, 100); add(6000, 250); add(10000, 500);
    const byPrice = (list) => list.filter((it) => it.price > 0 && !it.pass && !it.event).slice().sort((x, y) => x.price - y.price);
    const items = { paint: byPrice(SHOP.paints).map((x) => x.id), trail: byPrice(SHOP.trails).map((x) => x.id), avatar: byPrice(SHOP.avatars).map((x) => x.id) };
    const order = ['paint', 'trail', 'avatar'];
    let k = 0;
    return marks.map((at, i) => {
      const coins = Math.min(1500, Math.round((80 + at * 0.15) / 10) * 10);
      if (i % 2 === 0) return { at, coins }; // every other step: coins
      // the others: the next unlock (paint, trail, avatar in turn), coins once they run out
      for (let tries = 0; tries < 3; tries++) {
        const kind = order[k++ % 3];
        if (items[kind].length) return { at, [kind]: items[kind].shift(), coins: at % 1000 === 0 ? coins : 0 };
      }
      return { at, coins: coins * 2 };
    });
  })();

  const giftAmount = (streak) => 50 + Math.min(6, Math.max(1, streak) - 1) * 25;
  // coins the game may report per claim (logged-in players), and per day in total
  const EARN = { match: 1000, ad: 1000, chest: 200, challenge: 250, ach: 800 };
  const EARN_PER_DAY = 12000;
  const MATCH_GAP = 20; // seconds between two match rewards

  // ---------------- Cog Pass: a 4-week season of 30 free tiers ----------------
  const SEASON_EPOCH = Date.UTC(2026, 9, 22), SEASON_DAYS = 28;
  function season(now) {
    const t = now || Date.now();
    const n = Math.max(0, Math.floor((t - SEASON_EPOCH) / (SEASON_DAYS * DAY)));
    const start = SEASON_EPOCH + n * SEASON_DAYS * DAY;
    return { id: n + 1, start, end: start + SEASON_DAYS * DAY };
  }
  const PASS = { tiers: 30, perTier: 100, match: 50, challenge: 25, gift: 20 };
  // each season: 2 paints, 2 trails and 2 avatars from the pass-only pool, in turn; coins on the other tiers
  function passRewards(seasonId) {
    const pool = { paints: SHOP.paints.filter((x) => x.pass), trails: SHOP.trails.filter((x) => x.pass), avatars: SHOP.avatars.filter((x) => x.pass) };
    const kinds = ['paints', 'trails', 'avatars', 'paints', 'trails', 'avatars'];
    const used = { paints: 0, trails: 0, avatars: 0 };
    const out = [];
    for (let t = 1; t <= PASS.tiers; t++) {
      const r = { tier: t, at: t * PASS.perTier, coins: Math.round((50 + t * 8) / 10) * 10 };
      if (t % 5 === 0) {
        const kind = kinds[t / 5 - 1];
        const list = pool[kind];
        r[kind] = list[((seasonId - 1) * 2 + used[kind]++) % list.length].id;
        r.coins = t === PASS.tiers ? 1000 : 0;
      }
      out.push(r);
    }
    return out;
  }

  // ---------------- weekly events: a special mode with a twist, Monday to Monday (UTC) ----------------
  const WEEKLY = [
    { id: 'moon', name: 'Moon Week', icon: '🌙', mode: 'clash', desc: 'Low gravity: huge jumps and long flights', mods: { grav: 0.45 } },
    { id: 'surge', name: 'Super Surge', icon: '⚡', mode: 'koth', desc: 'Supers charge 3× faster', mods: { superRate: 3 } },
    { id: 'glass', name: 'Glass Cannons', icon: '💥', mode: 'clash', desc: 'Everything deals double damage', mods: { dmg: 2 } },
    { id: 'turbo', name: 'Turbo Week', icon: '🏎', mode: 'race', desc: 'Mechs are 35% faster', mods: { speed: 1.35 } },
    { id: 'blitz', name: 'Bounty Blitz', icon: '🎯', mode: 'bounty', desc: 'Bounty Hunt with supers charging 2× faster', mods: { superRate: 2 } },
    { id: 'gadget', name: 'Gadget Frenzy', icon: '🧰', mode: 'gold', desc: 'Gadgets recharge 3× faster', mods: { gadgetRate: 3 } },
  ];
  const WEEK_EPOCH = Date.UTC(2026, 9, 19); // a Monday
  function week(now) {
    const t = now || Date.now();
    const n = Math.max(0, Math.floor((t - WEEK_EPOCH) / (7 * DAY)));
    return Object.assign({ n, endsAt: WEEK_EPOCH + (n + 1) * 7 * DAY }, WEEKLY[n % WEEKLY.length]);
  }

  // ---------------- Ranked: unlocked at 100 best trophies, its own points, reset each season ----------------
  const RANKED = {
    unlockAt: 100,
    modes: ['koth', 'gold', 'bounty'],
    win: 30, loss: -18,
    ranks: [
      { at: 0, name: 'Bronze', icon: '🟤' }, { at: 150, name: 'Silver', icon: '⚪' }, { at: 400, name: 'Gold', icon: '🟡' },
      { at: 750, name: 'Platinum', icon: '🔷' }, { at: 1200, name: 'Diamond', icon: '💎' }, { at: 1800, name: 'Mythic', icon: '🔮' },
      { at: 2600, name: 'Legendary', icon: '🔥' }, { at: 3600, name: 'Masters', icon: '👑' },
    ],
  };
  RANKED.rank = (rp) => RANKED.ranks.filter((x) => (rp | 0) >= x.at).pop();

  // ---------------- levels, parts and mech rules (the server checks online mechs with these) ----------------
  const xpFor = (level) => { const n = level - 1; return 150 * n + 50 * n * (n - 1); };
  const levelOf = (xp) => { let lv = 1; while (xpFor(lv + 1) <= (xp || 0)) lv++; return lv; };
  // movement types a mech may combine, by level (Mono / Hybrid / Omni)
  const domainsAt = (level) => (level >= 6 ? 3 : level >= 3 ? 2 : 1);
  // [cost, movement type, level it unlocks at, HP, damage per second] for every part
  // (parts.js takes cost and type from here; the server's referee uses HP and damage)
  const PARTS = {
    core: [0, null, 1, 150, 0], camera: [0, null, 1, 45, 0], frame: [4, null, 1, 35, 0], armor: [10, null, 1, 120, 0], wheel: [12, 'land', 1, 35, 0], leg: [20, 'land', 1, 45, 0],
    float: [8, 'water', 1, 25, 0], prop: [16, 'water', 1, 28, 0], wing: [12, 'air', 1, 25, 0], rotor: [30, 'air', 1, 30, 0], jet: [26, 'air', 1, 30, 0], engine: [20, null, 1, 45, 0],
    cannon: [24, null, 1, 40, 33], rocket: [36, null, 3, 40, 28], laser: [34, null, 6, 35, 26], railgun: [42, null, 7, 40, 22], flamer: [28, null, 4, 40, 34], saw: [16, null, 3, 60, 45],
    spikes: [10, null, 2, 70, 40], shield: [32, null, 5, 40, 0], drone: [30, null, 5, 30, 0], booster: [18, null, 4, 30, 0], flag: [1, null, 1, 10, 0], lamp: [1, null, 2, 10, 0], horn: [2, null, 3, 15, 0],
    // since v1.8: big wheels and car/truck body parts
    bigwheel: [22, 'land', 1, 60, 0], body: [6, null, 1, 50, 0], plate: [3, null, 1, 30, 0], nose: [6, null, 1, 45, 0], cabin: [10, null, 1, 55, 0],
    fender: [4, null, 1, 30, 0], spoiler: [5, null, 1, 25, 0], lights: [3, null, 1, 20, 0], exhaust: [3, null, 1, 20, 0],
  };
  // a mech's total HP and the most damage per second its weapons can deal (for the referee)
  function mechPower(parts) {
    let hp = 0, dps = 0;
    for (const p of Array.isArray(parts) ? parts : []) { const r = p && Object.prototype.hasOwnProperty.call(PARTS, p.t) ? PARTS[p.t] : null; if (r) { hp += r[3]; dps += r[4]; } }
    return { hp, dps };
  }
  const BUDGET = 500, RUSH_BUDGET = 300, MAX_PARTS = 150, GRID = { minX: -4, maxX: 4, minY: -2, maxY: 4, minZ: -4, maxZ: 4 };
  // a part's look (v1.9.4): r = turned (1-7), s = a shape's short name; looks only, so the server just passes them on
  const partLook = (p, o) => {
    const r = p.r | 0;
    if (r > 0 && r < 8) o.r = r;
    if (typeof p.s === 'string' && /^[a-z]{1,10}$/.test(p.s)) o.s = p.s;
    return o;
  };
  // why a mech isn't allowed for a player of this level (or null when it's fine)
  function mechProblem(parts, level, budget) {
    if (!Array.isArray(parts) || !parts.length || parts.length > MAX_PARTS) return 'no parts';
    let cost = 0, cores = 0;
    const doms = new Set(), at = new Set();
    for (const p of parts) {
      const r = p && Object.prototype.hasOwnProperty.call(PARTS, p.t) ? PARTS[p.t] : null;
      if (!r) return 'unknown part';
      if (r[2] > level) return `${p.t} unlocks at level ${r[2]}`;
      if (!(p.x >= GRID.minX && p.x <= GRID.maxX && p.y >= GRID.minY && p.y <= GRID.maxY && p.z >= GRID.minZ && p.z <= GRID.maxZ)) return 'part outside the grid';
      const k = p.x + ',' + p.y + ',' + p.z;
      if (at.has(k)) return 'two parts in one spot';
      at.add(k);
      cost += r[0];
      if (r[1]) doms.add(r[1]);
      if (p.t === 'core') cores++;
    }
    if (cores !== 1) return 'needs exactly one core';
    if (cost > (budget || BUDGET)) return `over budget (${cost})`;
    if (doms.size > domainsAt(level)) return 'too many movement types for this level';
    return null;
  }

  // ---------------- daily challenges: the same 6 for everyone each UTC day; the server pays the listed reward ----------------
  const CHALLENGES = [
    { type: 'wreck', text: 'Wreck {n} mechs', n: [3, 5, 8], reward: 60 },
    { type: 'win', text: 'Win {n} match{es}', n: [1, 2], reward: 90 },
    { type: 'rush', text: 'Play {n} Rush Build matches', n: [2, 3], reward: 60 },
    { type: 'clash', text: 'Play {n} Workshop Clash matches', n: [2, 3], reward: 60 },
    { type: 'dash', text: 'Dash {n} times', n: [15, 30], reward: 40 },
    { type: 'air', text: 'Fly for {n} seconds', n: [30, 60], reward: 60 },
    { type: 'water', text: 'Spend {n} seconds in water', n: [30, 60], reward: 50 },
    { type: 'elim', text: 'Eliminate {n} pilots', n: [2, 4], reward: 70 },
    { type: 'parts', text: 'Blow off {n} enemy parts', n: [25, 50], reward: 50 },
    { type: 'ram', text: 'Land {n} spike rams', n: [3, 6], reward: 70 },
    { type: 'team', text: 'Win a team match (3v3 or 2v2v2v2)', n: [1], reward: 100 },
    { type: 'chest', text: 'Open {n} loot chests', n: [3, 6], reward: 60 },
    { type: 'kothwin', text: 'Win a King of the Hill match', n: [1], reward: 90 },
    { type: 'podium', text: 'Finish a Combat Race in the top 3', n: [1], reward: 80 },
    { type: 'goldcollect', text: 'Collect {n} gold in Gold Rush', n: [10, 20], reward: 70 },
    { type: 'bosswin', text: 'Defeat the Titan in Boss Battle', n: [1], reward: 150 },
    { type: 'maps', text: 'Play on {n} different maps', n: [3, 4], reward: 70 },
    { type: 'wave', text: 'Reach wave {n} in Survival', n: [4, 6], reward: 80 },
    { type: 'bountywin', text: 'Win a Bounty Hunt match', n: [1], reward: 90 },
    { type: 'gadget', text: 'Use your gadget {n} times', n: [5, 10], reward: 50 },
  ];
  const DAILY_CHALLENGES = 6;
  function dailyChallenges(dayStr) {
    const rnd = seeded('cw' + dayStr);
    const pool = CHALLENGES.slice();
    const list = [];
    while (list.length < DAILY_CHALLENGES) {
      const c = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
      const n = c.n[Math.floor(rnd() * c.n.length)];
      list.push({ type: c.type, text: c.text.replace('{n}', n).replace('{es}', n > 1 ? 'es' : ''), target: n, reward: c.reward + (n > c.n[0] ? 30 : 0) });
    }
    return list;
  }
  // achievement rewards (each achievement's test lives in js/extras.js)
  const ACH = { first: 50, win1: 100, win10: 300, wreck10: 100, wreck50: 250, wreck200: 600, elim25: 200, ram10: 150, dash100: 100, fly300: 150, swim300: 150, streak3: 150, pickup20: 120, chest25: 200, survive10: 300, hillking: 150, golddigger: 200, speeddemon: 200, titanslayer: 400, worldtour: 300, modemaster: 300, bothModes: 100, hybrid: 200, omni: 400, big: 200, flawless: 300 };

  // ready-made chat lines (quick chat): friends, party and club chat, and everything for "Quick chat only" players
  const TALK_QUICK = ['👋 Hi!', 'GG!', 'Want to play?', 'Party up! 🎉', 'Nice one! 🏆', 'Thanks! 🙏', 'One more?', 'Be right back', 'Yes 👍', 'No 👎', "Let's go! 🔥", 'Good night 🌙'];

  // ---------------- seasonal events: a theme for each special time of the year (UTC dates, every year) ----------------
  // While one runs the menu and the arenas are decorated, every match and daily challenge gives event points (the
  // server counts them), and an event track pays coins and three exclusive items that are never sold.
  const EVENTS = [
    { id: 'halloween', name: 'Haunted Harvest', icon: '🎃', color: '#ff8a1f', from: [10, 20], to: [11, 3], desc: 'Pumpkins glow in every arena, the nights get spooky and bats fill the sky.', paint: 'ev_pumpkin', trail: 'ev_spooky', wreck: 'ev_bats' },
    { id: 'winter', name: 'Winter Wonderland', icon: '🎄', color: '#7fd7ff', from: [12, 10], to: [1, 6], desc: 'Snow everywhere, presents, snowmen and trees full of lights. Happy holidays!', paint: 'ev_frost', trail: 'ev_snowflake', wreck: 'ev_snow' },
    { id: 'love', name: 'Mech Hearts', icon: '💘', color: '#ff5d9e', from: [2, 7], to: [2, 16], desc: 'Hearts float over the arenas and heart balloons are everywhere.', paint: 'ev_rose', trail: 'ev_love', wreck: 'ev_hearts' },
    { id: 'spring', name: 'Spring Bloom', icon: '🌸', color: '#ff9fd0', from: [3, 20], to: [4, 20], desc: 'Blossom petals drift on the wind and flowers bloom in every arena.', paint: 'ev_blossom', trail: 'ev_bloom', wreck: 'ev_petals' },
    { id: 'summer', name: 'Summer Splash', icon: '🏖', color: '#ffd23f', from: [7, 1], to: [8, 31], desc: 'Sunny days, beach umbrellas and beach balls. Hit the water!', paint: 'ev_tropic', trail: 'ev_wave', wreck: 'ev_splash' },
  ];
  const EVENT_PTS = { match: 40, challenge: 20 };
  // the event running now (or null): { ...event, key: 'halloween2026', start, end }
  function event(now) {
    const t = new Date(now || Date.now());
    const y = t.getUTCFullYear();
    for (const e of EVENTS) {
      for (const sy of [y, y - 1]) { // an event that starts in December ends in January
        const start = Date.UTC(sy, e.from[0] - 1, e.from[1]);
        const ey = e.to[0] < e.from[0] ? sy + 1 : sy;
        const end = Date.UTC(ey, e.to[0] - 1, e.to[1] + 1); // through the whole last day
        if (t.getTime() >= start && t.getTime() < end) return Object.assign({}, e, { key: e.id + sy, start, end });
      }
    }
    return null;
  }
  // the next one to come (for "coming soon")
  function nextEvent(now) {
    const t = now || Date.now();
    for (let d = 1; d < 400; d++) { const e = event(t + d * DAY); if (e) return e; }
    return null;
  }
  // the event track: points needed and what each step pays
  function eventRewards(id) {
    const e = EVENTS.find((x) => x.id === id);
    if (!e) return [];
    return [{ step: 1, at: 150, coins: 250 }, { step: 2, at: 400, paint: e.paint }, { step: 3, at: 800, trail: e.trail }, { step: 4, at: 1300, wreck: e.wreck }];
  }

  // ---------------- Weekend Cup: Friday 18:00 → Monday 00:00 UTC, one mode, your best 10 matches count ----------------
  // Accounts only. Every cup match gives points for your place (the server's checked result); your score is the sum of
  // your 10 best matches, so playing more can only help, but a few great matches beat lots of bad ones. After the
  // weekend everyone who played claims a reward by their final place; the top 3 also get the Champion trail.
  const CUP = {
    modes: ['clash', 'koth', 'gold', 'bounty', 'race'],
    best: 10, minGames: 3,
    rewards: [{ upTo: 1, coins: 2500, trail: 'cup_champ' }, { upTo: 3, coins: 1500, trail: 'cup_champ' }, { upTo: 10, coins: 800 }, { upTo: 50, coins: 400 }, { upTo: 1e9, coins: 200 }],
    tryReward: 50, // fewer than minGames matches
  };
  // points for one match: 1st of 8 → 12, last → 2; two places (team matches) → win 10, loss 3
  function cupPoints(place, n) {
    if (n <= 2) return place === 1 ? 10 : 3;
    return Math.max(1, Math.round(2 + (10 * (n - place)) / (n - 1)));
  }
  // the cup of this weekend (live) or the last one (ended), and when the next starts
  function cup(now) {
    const t = now || Date.now(), d = new Date(t);
    let start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 2) % 7), 18); // Friday 18:00
    if (start > t) start -= 7 * DAY;
    const end = start + 2 * DAY + 6 * 3600e3, id = 'cup' + new Date(start).toISOString().slice(0, 10);
    return { id, start, end, next: start + 7 * DAY, live: t < end, mode: CUP.modes[hash(id) % CUP.modes.length] };
  }
  // your score: the sum of your best `best` matches
  function cupScore(pts) { return (pts || []).slice().sort((a, b) => b - a).slice(0, CUP.best).reduce((s, x) => s + x, 0); }
  function cupReward(rank, games) {
    if (games < CUP.minGames) return { coins: CUP.tryReward };
    return Object.assign({}, CUP.rewards.find((r) => rank <= r.upTo));
  }

  const api = { CUP, cup, cupPoints, cupScore, cupReward, EVENTS, EVENT_PTS, event, nextEvent, eventRewards, TALK_QUICK, xpFor, levelOf, domainsAt, PARTS, partLook, mechPower, BUDGET, RUSH_BUDGET, MAX_PARTS, GRID, mechProblem, CHALLENGES, DAILY_CHALLENGES, dailyChallenges, ACH, SHOP, AVATAR_COUNT, FREE_AVATARS, item, dealPrice, dailyDeals, ROAD, giftAmount, EARN, EARN_PER_DAY, MATCH_GAP, day, nextMidnight, seeded, hash, season, PASS, passRewards, WEEKLY, week, RANKED };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.CW = root.CW || {}; root.CW.ECON = api; root.CW.SHOP = SHOP; root.CW.ROAD = ROAD; }
})(this);
