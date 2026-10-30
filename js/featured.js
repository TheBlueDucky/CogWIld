// Cogwild — today's featured event: one mode on one arena, the same for every player in the world.
// It changes at midnight UTC. Playing it gives 2× coins, and trophy gains are 50% bigger.
// Also the arena rotation: "Any arena" matches online are played on 5 arenas that change every 3 hours
// (today's featured arena is always one of them), so every arena gets its turn.
// Used by the game (window.CW.FEATURED) and by the server (require), so both always agree.
(function (root) {
  const MODES = ['clash', 'rush', 'koth', 'gold', 'bounty', 'race', 'boss', 'survival', 'heist', 'ball', 'derby', 'scrap'];
  // v1.10.1: every match picks a random arena that fits its mode (Mech Ball has its own stadium)
  const MODE_ARENAS = {
    ball: ['stadium'],
    heist: ['canyon', 'desert', 'jungle', 'scrap', 'speedway', 'moon', 'city', 'swamp'],
    derby: ['canyon', 'desert', 'scrap', 'speedway', 'moon', 'city', 'stadium'],
  };
  // the arenas a mode can be played on (only those in `have`, e.g. what every player's game knows)
  function arenasFor(mode, have) {
    const all = have || ARENAS.concat(['stadium']);
    const ok = (MODE_ARENAS[mode] || ARENAS).filter((a) => all.includes(a));
    return ok.length ? ok : all.filter((a) => a !== 'stadium');
  }
  const CLASSIC = ['canyon', 'isles', 'volcano', 'desert', 'swamp', 'city', 'jungle', 'scrap']; // games before v1.9 know only these
  const ARENAS = CLASSIC.concat(['speedway', 'bay', 'moon']);
  const ROT_HOURS = 3, ROT_SIZE = 5;
  const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
  function today(now) {
    const t = new Date(now || Date.now());
    const day = t.toISOString().slice(0, 10);
    const h = hash('featured:' + day);
    return { day, mode: MODES[h % MODES.length], arena: ARENAS[(h >>> 8) % ARENAS.length], endsAt: Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1) };
  }
  function rotation(now) {
    const t = now || Date.now(), slot = Math.floor(t / (ROT_HOURS * 3600e3));
    const f = today(t).arena, pool = ARENAS.filter((a) => a !== f), arenas = [f];
    while (arenas.length < ROT_SIZE) arenas.push(pool.splice(hash('rot:' + slot + ':' + arenas.length) % pool.length, 1)[0]);
    return { arenas, endsAt: (slot + 1) * ROT_HOURS * 3600e3 };
  }
  // featured today is a mode now (v1.10.1: arenas are random); `arena` stays for older games
  const api = { today, rotation, MODES, ARENAS, CLASSIC, MODE_ARENAS, arenasFor, COIN_MULT: 2, TROPHY_MULT: 1.5, is: (mode, arena, now) => today(now).mode === mode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CW.FEATURED = api;
})(this);
