// Runs inside the game page (tools/video): the match set-up for the videos. Your mech + loadout, the bots a bit
// livelier (they dodge, jump and use their tricks like hard bots, but aim and hit like normal ones), no seasonal
// decorations (the videos stay up all year), and a clean HUD (no voice/chat buttons, no key help line).
(() => {
  const g = window.game, CW = window.CW;
  const P = (list) => list.map(([t, x, y, z, r, s]) => Object.assign({ t, x, y, z }, r ? { r } : {}, s ? { s } : {}));
  const MECHS = {
    // Workshop Clash: a fast armored monster truck with twin cannons, twin rockets and a laser
    clash: {
      name: 'Thunderclap', color: 0x3a86ff,
      parts: P([['core', 0, 0, 0], ['body', 0, 0, -1, 0, 'edge'], ['body', 0, 0, 1], ['nose', 0, 0, -2], ['body', 0, 0, 2, 2, 'curve'],
        ['bigwheel', -1, 0, -1], ['bigwheel', 1, 0, -1], ['bigwheel', -1, 0, 1], ['bigwheel', 1, 0, 1], ['armor', -1, 0, 0], ['armor', 1, 0, 0],
        ['camera', 0, 1, -1], ['cabin', 0, 1, 0], ['cannon', -1, 1, -1], ['cannon', 1, 1, -1], ['laser', 0, 2, 0], ['rocket', -1, 1, 1], ['rocket', 1, 1, 1],
        ['engine', 0, 1, 1], ['engine', 0, 1, 2], ['booster', 0, 0, 3], ['spoiler', 0, 2, 1, 0, 'fin'], ['lights', 0, 0, -3], ['exhaust', -1, 1, 2], ['exhaust', 1, 1, 2],
        ['plate', -1, 1, 0], ['plate', 1, 1, 0]]),
      lo: { sp: 'orbital', gd: 'jump', pk: ['plating', 'regen'] },
    },
    // Mech Ball: a low, quick striker car with a wide front
    ball: {
      name: 'Striker', color: 0x3a86ff,
      parts: P([['core', 0, 0, 0], ['body', 0, 0, -1], ['body', -1, 0, -2, 0, 'edge'], ['body', 1, 0, -2, 0, 'edge'], ['nose', 0, 0, -2], ['body', 0, 0, 1],
        ['wheel', -1, 0, -1], ['wheel', 1, 0, -1], ['wheel', -1, 0, 1], ['wheel', 1, 0, 1], ['fender', -1, 1, -1], ['fender', 1, 1, -1], ['fender', -1, 1, 1], ['fender', 1, 1, 1],
        ['camera', 0, 1, -1], ['cabin', 0, 1, 0, 0, 'canopy'], ['cannon', -1, 0, 0], ['cannon', 1, 0, 0], ['engine', 0, 1, 1], ['engine', 0, 0, 2], ['booster', 0, 1, 2],
        ['spoiler', 0, 2, 1], ['exhaust', -1, 0, 2], ['exhaust', 1, 0, 2], ['lights', -1, 0, -3], ['lights', 1, 0, -3]]),
      lo: { sp: 'overdrive', gd: 'nitro', pk: ['dashpro', 'plating'] },
    },
  };
  window.__setup = {
    MECHS,
    check(kind) { const m = MECHS[kind]; return { v: CW.validate(m.parts, 3), a: (({ cost, power, mass, speed }) => ({ cost, power, mass, speed }))(CW.analyze(m.parts)) }; },
    // before the match: your mech and loadout
    prepare(kind, opts, arenaId) {
      opts = opts || {};
      const m = MECHS[kind];
      g.currentBp = { name: m.name, parts: m.parts.map((p) => Object.assign({}, p)), color: m.color };
      const own = g.profile.owned = g.profile.owned || {};
      own.supers = [m.lo.sp]; own.gadgets = [m.lo.gd]; own.perks = m.lo.pk.slice();
      Object.assign(g.settings, { loSuper: m.lo.sp, gadget: m.lo.gd, loPerks: m.lo.pk.slice(), timeOfDay: opts.tod || 'day', difficulty: 'normal' });
      // the arena is always built fresh (no seasonal decorations, and nothing left over from the menu)
      CW.ECON.event = () => null;
      g.world.dispose(); g.world = new CW.World(g.scene, arenaId || g.world.arena.id); g.world.setDetail(g.gfx || 'high'); g.world.applyTime('day', g);
      g.showcaseSpot = null; if (g.showcase) { g.scene.remove(g.showcase); g.showcase = null; }
      let st = document.getElementById('__vidcss');
      if (!st) { st = document.createElement('style'); st.id = '__vidcss'; document.head.appendChild(st); }
      st.textContent = '#hudTalk, #hint, #recDot, #notes .guest, #fps { display: none !important; }';
    },
    // start the match offline (like PLAY with no internet), with this mech
    start(kind, mode, arena, opts) {
      this.prepare(kind, opts, arena);
      g.setEvent(null);
      g.modeId = mode; g.formatId = (opts && opts.format) || CW.MM_FORMAT[mode]; g.forceArena = arena;
      const bp = CW.cloneBp(g.currentBp); bp.color = MECHS[kind].color; bp.lo = CW.myLoadout(g);
      g.startMatch(bp);
      g.forceArena = null;
      this.tuneBots((opts && opts.botDmg) || 0.75);
      // arena events: the exciting ones only (meteors, lightning, lava bombs), never a sandstorm or a blackout that hides the view
      if (!g.hazards.__vid) {
        const ot = g.hazards.trigger.bind(g.hazards);
        g.hazards.trigger = (ev) => ot(ev && !['sandstorm', 'blackout'].includes(ev) ? ev : ({ isles: 'storm', swamp: 'storm', jungle: 'storm', bay: 'storm', speedway: 'storm', volcano: 'eruption' })[g.world.arena.id] || 'meteor');
        g.hazards.__vid = true;
      }
      if (window.__pilot) window.__pilot.reset();
      // Mech Ball: your shots get a little help (like aim assist): a hit that already goes roughly at their goal is
      // steered the rest of the way and a bit harder, and your touches never go into your own goal. The other team's
      // guns hurt less here (they'd keep you from the ball).
      if (mode === 'ball' && g.obj && g.obj.touch) {
        const o = g.obj, ST = CW.STADIUM, V3 = THREE.Vector3;
        const ot = o.touch.bind(o);
        let lock = null; // a shot's direction for a moment, while the car is still pushing the ball
        o.touch = () => {
          const before = o.vel.clone();
          ot();
          const me = g.player;
          if (lock && lock.n-- > 0) { if (o.lastTouch === me) { o.vel.x = lock.vx; o.vel.z = lock.vz; o.vel.y = Math.min(o.vel.y, lock.vy); } return; }
          lock = null;
          if (o.lastTouch !== me) return;
          const their = o.goals[1 - me.team], mine = o.goals[me.team];
          const sp = Math.hypot(o.vel.x, o.vel.z);
          if (sp < 1) return;
          const dirv = new V3(o.vel.x / sp, 0, o.vel.z / sp);
          // never an own goal (also not a slow push into the net): the ball glances off to the side instead
          const toMine = new V3(mine.x - o.pos.x, 0, -o.pos.z).normalize();
          if (dirv.dot(toMine) > 0.45 && Math.abs(o.pos.x - mine.x) < 75) {
            o.vel.x = -o.vel.x * 0.6; o.vel.z += (o.pos.z >= 0 ? 1 : -1) * Math.max(6, sp * 0.4);
            return;
          }
          if (o.vel.distanceTo(before) < 2 || sp < 4) return;
          // aim into the net (past the goal line), at the side of the mouth the ball is on
          const sg = Math.sign(their.x), aim = new V3(their.x + sg * 2, 0, Math.max(-ST.goalW * 0.55, Math.min(ST.goalW * 0.55, o.pos.z * 0.5)));
          const want = new V3(aim.x - o.pos.x, 0, aim.z - o.pos.z).normalize();
          // a dash or flip into the ball that goes roughly at their goal is a power shot that reaches it (a lob from
          // far out); near their goal any decent hit becomes a real shot; elsewhere it's only nudged
          const pm = g.player.mech, power = pm && (pm.flipping > 0 || pm.dashTime > 0);
          const D = Math.abs(o.pos.x - their.x), d = dirv.dot(want);
          if ((power && d > 0.45 && D < 150) || (D < 70 && d > 0.6)) {
            const ns = Math.min(62, Math.max(34, D * 0.42 + 22, sp * 1.2));
            o.vel.x = want.x * ns; o.vel.z = want.z * ns;
            // just the lift to arrive under the crossbar (a flip used to send it sailing over), a bit of a lob from far
            const Gb = CW.GRAV * 0.55 * ((g.mods && g.mods.grav) || 1) * (CW.arena.grav || 1);
            const T = Math.hypot(aim.x - o.pos.x, aim.z - o.pos.z) / ns, ty = ST.y + 4.2 + 0.8;
            o.vel.y = Math.max(-2, Math.min(16, (ty - o.pos.y + 0.5 * Gb * T * T) / Math.max(0.15, T)));
            lock = { vx: o.vel.x, vz: o.vel.z, vy: o.vel.y, n: 12 };
            if (window.__pilot) window.__pilot.ev.push({ k: 'shot', f: window.__vt ? __vt.V.frame : 0, t: +g.matchTime.toFixed(2), D: Math.round(D), power: !!power });
          } else if (d > 0.8) { const k = 0.6, nd = dirv.clone().multiplyScalar(1 - k).addScaledVector(want, k).normalize(), ns = Math.max(22, sp * 1.15); o.vel.x = nd.x * ns; o.vel.z = nd.z * ns; }
        };
        for (const c of g.combatants) if (c.team !== g.player.team && c.mech) { c.mech.baseDmg = 0.08; c.baseDmg = 0.08; }
      }
      // Mech Ball: every goal goes in the log, with the game's slow motion
      if (g.obj && g.obj.goalFx) {
        const of = g.obj.goalFx.bind(g.obj);
        g.obj.goalFx = (team, who) => {
          if (window.__pilot) window.__pilot.ev.push({ k: 'goal', f: window.__vt ? __vt.V.frame : 0, t: +g.matchTime.toFixed(2), mine: team === g.player.team, by: who ? (who.isPlayer ? 'me' : who.name) : '' });
          g.slowmo = Math.max(g.slowmo || 0, 1.6);
          return of(team, who);
        };
      }
      return { arena: g.world.arena.id || arena, tod: g.timeOfDay, lo: g.player.lo, n: g.combatants.length };
    },
    // after the match starts: livelier bots that don't out-shoot you
    tuneBots(dmg) {
      for (const c of g.combatants) {
        if (c.isPlayer || !c.ai) continue;
        c.ai.smarts = 0.95; // dodges, jumps and tricks like hard bots
        c.ai.flair = Math.max(c.ai.flair, 0.6);
        if (c.mech) { c.mech.baseDmg = dmg; c.baseDmg = dmg; }
      }
    },
  };
})();
