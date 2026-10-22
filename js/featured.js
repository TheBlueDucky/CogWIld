// Cogwild — today's featured event: one mode on one arena, the same for every player in the world.
// It changes at midnight UTC. Playing it gives 2× coins, and trophy gains are 50% bigger.
// Used by the game (window.CW.FEATURED) and by the server (require), so both always agree.
(function (root) {
  const MODES = ['clash', 'rush', 'koth', 'gold', 'race', 'boss', 'survival'];
  const ARENAS = ['canyon', 'isles', 'volcano', 'desert', 'swamp', 'city', 'jungle'];
  const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
  function today(now) {
    const t = new Date(now || Date.now());
    const day = t.toISOString().slice(0, 10);
    const h = hash('featured:' + day);
    return { day, mode: MODES[h % MODES.length], arena: ARENAS[(h >>> 8) % ARENAS.length], endsAt: Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1) };
  }
  const api = { today, MODES, ARENAS, COIN_MULT: 2, TROPHY_MULT: 1.5, is: (mode, arena, now) => { const f = today(now); return f.mode === mode && f.arena === arena; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CW.FEATURED = api;
})(this);
