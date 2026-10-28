// Cogwild — what only the desktop app does (desktop/main.js + preload.js), v1.9.4:
// - its own title bar in the game's colors instead of the white Windows one (Windows draws the ─ □ ✕ buttons on it;
//   F11 / fullscreen hides it), so the window looks like part of the game
// - the Discord status: what you're doing, sent when it changes (desktop/discord.js shows it on your profile)
(function () {
  const CW = window.CW;
  // called by desktop/main.js with the bar's height (0 = no bar, e.g. fullscreen); mac: room for its window buttons
  CW.titleBar = (h, mac) => {
    let bar = document.getElementById('titleBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'titleBar';
      bar.setAttribute('translate', 'no');
      bar.innerHTML = '<img src="img/icon-192.png" alt="" draggable="false"><span>Cogwild</span>';
      document.body.insertBefore(bar, document.body.firstChild);
    }
    const root = document.documentElement;
    root.classList.toggle('tbar', h > 0);
    root.classList.toggle('tbar-mac', !!mac);
    root.style.setProperty('--tbh', (h | 0) + 'px');
    window.dispatchEvent(new Event('resize'));
  };

  if (!window.CogwildDesktop) return;
  let last = '', since = 0, was = '';
  const tick = () => {
    const g = CW.game || window.game;
    if (!g) return;
    const st = g.state;
    let details = 'In the menu', state = '';
    if (st === 'match') {
      const mode = CW.MODES && CW.MODES[g.modeId], arena = g.world && g.world.arena;
      details = g.modeId === 'tutorial' ? 'Learning to play (tutorial)' : g.modeId === 'test' ? 'Test-driving a mech' : g.spectator ? 'Watching a friend play' : `Playing ${mode ? mode.name : 'a match'}`;
      state = arena ? `${arena.name} · ${g.net && g.net.active ? 'online' : 'vs bots'}` : '';
      if (was !== 'match') since = Date.now();
    } else {
      since = 0;
      if (st === 'workshop') details = 'Building a mech in the Workshop';
      else if (st === 'lobby') details = g.net && g.net.room && !g.net.room.auto ? 'In a private room with friends' : 'Looking for a match';
      else if (st === 'results') details = 'Just finished a match';
      else if (st === 'replay') details = 'Watching a replay';
    }
    was = st;
    const key = `${details}|${state}|${since}`;
    if (key === last) return;
    last = key;
    try { window.CogwildDesktop.presence({ details, state, since }); } catch (e) { /* the app is closing */ }
  };
  setTimeout(tick, 1500);
  setInterval(tick, 3000);
})();
