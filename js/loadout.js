// Cogwild — the loadout (v1.10): the super, gadget and up to 2 perks you bring into a match, and part combos.
// The Shop sells them (js/economy.js SHOP.supers / gadgets / perks, the server keeps who owns what and strips
// anything not owned from online matches). Each combatant gets `c.lo = { sp, gd, pk: [] }`: yours from Settings
// (the PLAY panel), other players' from their blueprint (`bp.lo`), bots pick their own.
//
// Part combos: building a mech a certain way gives it a bonus (shown in the Workshop and at the start of a match).
// Everything a perk or combo changes is gathered in `mech.mods` (CW.mechMods), read by js/entities.js and js/game.js.
(function () {
  const CW = window.CW;
  const E = CW.ECON;
  CW.PERK_SLOTS = E.PERK_SLOTS;
  CW.shopItem = (kind, id) => E.item(kind, id);
  // free things (price 0) are everyone's once their level allows; the rest must be bought
  CW.ownsLo = (game, kind, id) => {
    const it = E.item(kind, id);
    if (!it) return false;
    if (it.price === 0) return (it.level || 1) <= game.level();
    return ((game.profile.owned && game.profile.owned[kind]) || []).includes(id);
  };
  // "Any mech" / "Needs: Flamethrower" / "Needs wheels or legs"
  CW.needText = (need) => {
    if (!need) return 'Any mech';
    if (need === 'land') return 'Needs wheels or legs';
    if (need === 'water') return 'Needs floats or propellers';
    if (need === 'air') return 'Needs wings, rotors or jets';
    return 'Needs: ' + need.map((t) => (CW.PARTS[t] ? CW.PARTS[t].name : t)).join(' / ');
  };
  // your loadout from Settings, with only what you own (settings.loSuper '' = your build's own super)
  CW.myLoadout = (game) => {
    const s = game.settings, lo = {};
    if (s.loSuper && CW.ownsLo(game, 'supers', s.loSuper)) lo.sp = s.loSuper;
    if (s.gadget && CW.ownsLo(game, 'gadgets', s.gadget)) lo.gd = s.gadget;
    const pk = (s.loPerks || []).filter((id) => CW.ownsLo(game, 'perks', id)).slice(0, CW.PERK_SLOTS);
    if (pk.length) lo.pk = pk;
    return lo;
  };
  // bots: something that fits their mech, now and then a perk or two (more on hard)
  CW.botLoadout = (bp, difficulty) => {
    const parts = bp.parts || [];
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const sps = E.SHOP.supers.filter((x) => E.fits(x.need, parts));
    const gds = E.SHOP.gadgets.filter((x) => E.fits(x.need, parts));
    const lo = {};
    if (Math.random() < 0.6) lo.sp = pick(sps).id;
    lo.gd = pick(gds).id;
    const n = difficulty === 'hard' ? 2 : difficulty === 'easy' ? 0 : Math.random() < 0.5 ? 1 : 0;
    const pool = E.SHOP.perks.map((x) => x.id).sort(() => Math.random() - 0.5);
    if (n) lo.pk = pool.slice(0, n);
    return lo;
  };
  CW.cleanLo = (lo) => {
    if (!lo || typeof lo !== 'object') return undefined;
    const out = {};
    if (E.item('supers', lo.sp)) out.sp = lo.sp;
    if (E.item('gadgets', lo.gd)) out.gd = lo.gd;
    if (Array.isArray(lo.pk)) { const pk = lo.pk.filter((id) => E.item('perks', id)).slice(0, CW.PERK_SLOTS); if (pk.length) out.pk = pk; }
    return Object.keys(out).length ? out : undefined;
  };
  CW.hasPerk = (c, id) => !!(c && c.lo && c.lo.pk && c.lo.pk.includes(id));
  // how far away this one grabs power-ups, loot, gold and scrap (Loot Magnet = twice as far)
  CW.grabK = (c) => (CW.hasPerk(c, 'magnet') ? 2 : 1);

  // ---------------- part combos ----------------
  const n = (s, ...ts) => ts.reduce((a, t) => a + (s.count[t] || 0), 0);
  CW.COMBOS = [
    { id: 'grinder', name: 'Grinder', icon: '⚙', desc: '+30% ram and saw damage', test: (s) => n(s, 'saw', 'spikes') >= 4, mods: { ramK: 1.3 } },
    { id: 'fortress', name: 'Fortress', icon: '🏰', desc: '+15% HP, a bit slower', test: (s) => n(s, 'armor') >= 6 && n(s, 'armor') >= s.total * 0.35, mods: { hpK: 1.15, speedK: 0.92 } },
    { id: 'gunship', name: 'Gunship', icon: '🔫', desc: '+12% fire rate', test: (s) => Math.max(...['cannon', 'rocket', 'laser', 'railgun', 'flamer', 'mortar', 'harpoon', 'tesla', 'magnet'].map((t) => n(s, t))) >= 4, mods: { rateK: 1.12 } },
    { id: 'ace', name: 'Ace Pilot', icon: '🛩', desc: '+15% speed in the air', test: (s) => n(s, 'wing', 'jet') >= 5, mods: { airK: 1.15 } },
    { id: 'navy', name: 'Navy', icon: '⚓', desc: '+15% speed in water, +10% HP', test: (s) => n(s, 'float', 'prop') >= 6, mods: { waterK: 1.15, hpK: 1.1 } },
    { id: 'monster', name: 'Monster Truck', icon: '🛻', desc: '+25% ram damage, rams anything', test: (s) => n(s, 'bigwheel') >= 4, mods: { ramK: 1.25, ramAll: true } },
    { id: 'speedster', name: 'Speedster', icon: '⚡', desc: 'Dash recharges 30% faster', test: (s) => n(s, 'booster') >= 3, mods: { dashK: 0.7 } },
    { id: 'artillery', name: 'Artillery', icon: '🎯', desc: '+25% blast size', test: (s) => n(s, 'rocket', 'mortar') >= 3, mods: { splashK: 1.25 } },
    { id: 'glass', name: 'Glass Cannon', icon: '💥', desc: '+15% damage, 10% less HP', test: (s) => s.weapons >= 6 && n(s, 'armor') === 0, mods: { dmgK: 1.15, hpK: 0.9 } },
  ];
  CW.combosFor = (parts) => {
    const s = { count: {}, total: parts.length, weapons: 0 };
    for (const p of parts) { s.count[p.t] = (s.count[p.t] || 0) + 1; if (CW.PARTS[p.t] && CW.PARTS[p.t].weapon) s.weapons++; }
    return CW.COMBOS.filter((c) => c.test(s));
  };

  // everything perks and combos change for one mech (1 = no change)
  CW.mechMods = (c, parts) => {
    const m = { hpK: 1, dmgK: 1, speedK: 1, airK: 1, waterK: 1, rateK: 1, ramK: 1, dashK: 1, splashK: 1, ramAll: false, absorb: 1, repairK: 1, regen: false, combos: [] };
    for (const cb of CW.combosFor(parts)) {
      m.combos.push(cb);
      for (const [k, v] of Object.entries(cb.mods)) m[k] = typeof v === 'boolean' ? v || m[k] : m[k] * v;
    }
    if (CW.hasPerk(c, 'plating')) m.hpK *= 1.12;
    if (CW.hasPerk(c, 'overclock')) m.dmgK *= 1.07;
    if (CW.hasPerk(c, 'dashpro')) m.dashK *= 0.75;
    if (CW.hasPerk(c, 'absorbers')) m.absorb = 0.55;
    if (CW.hasPerk(c, 'quickfix')) m.repairK = 1.4;
    if (CW.hasPerk(c, 'regen')) m.regen = true;
    return m;
  };
})();
