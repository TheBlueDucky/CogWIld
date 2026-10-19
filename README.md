# Cogwild

Build any mech, then fight on land, water and sky. A 3D browser game made with three.js, with single-player matches against bots (online multiplayer is planned).

## Run it

```bash
py serve.py
```

Then open http://localhost:8765. (Double-clicking `index.html` also works in most browsers.)
`serve.py` turns off caching so code changes always show up after a reload.

## Features
- **Workshop**: snap-together building with 25 textured metal parts, mirror mode, undo/redo, paint, blueprints with share codes, Test Drive
- **7 modes**: Rush Build, Workshop Clash, King of the Hill, Gold Rush (each in 1v1, 3v3, 2v2v2v2 or 8-player free-for-all), Combat Race (6 racers), Survival and Boss Battle (solo or with 2 bot teammates)
- **7 arenas**: Canyon Lake, Frost Isles, Volcano Rift (lava), Desert Mesa, Toxic Swamp (sludge), Neon City and Jungle Temple, each in Day, Sunset or Night
- **Fair play**: safe spawns, spawn shield, unstuck key (F), pilots thrown clear of lava
- **Loot chests** on the map, supply drops, and a free reward chest after every match
- **First-person Camera part**, dash, power-ups, pilot on foot, spike rams, sudden death
- **Progression**: levels, ranks (Mono/Hybrid/Omni), part unlocks, coins, shop, daily reward, daily challenges, 18 achievements, stats
- **Interactive tutorial**, clip recorder (F8), controller support, graphics settings (auto-lowers on slow PCs), save backup/restore
- **Portal-ready**: CrazyGames/Poki ad hooks in `js/platform.js` (inactive until you add their SDK)

## Controls
| Mech | Keyboard / mouse | Controller |
|---|---|---|
| Drive / turn | W S / A D (or look while driving) | Left stick |
| Look & aim / fire | Mouse / click | Right stick / RT |
| Dash | Shift (Legs + A/D = sidestep) | X |
| Up / jump · Down | Space · C, Q or Ctrl | A · B or LT |
| Exit / enter mech | E | Y |
| Camera · Scoreboard · Clip | V · Tab · F8 | RB · View · D-pad up |

## Project structure
| File | What it does |
|---|---|
| `index.html` | Page, menus, HUD and all CSS |
| `js/parts.js` | Part definitions, part 3D models, stat analysis, example mechs |
| `js/world.js` | Arenas (terrain, water, bridges, sky, decor, minimap, boundary) |
| `js/entities.js` | Mech physics, pilots, weapons, projectiles, effects |
| `js/workshop.js` | The Workshop / Rush Build editor |
| `js/game.js` | Game flow, modes, teams, bots, camera, HUD, audio |
| `js/meta.js` | Coins, challenges, shop, stats, settings panels |
| `js/extras.js` | Power-ups, chests, music, achievements, part unlocks, bot variety |
| `js/modes.js` | Objective modes: King of the Hill, Gold Rush, Combat Race, Boss Battle |
| `js/tutorial.js` · `js/clips.js` · `js/gamepad.js` | Tutorial, clip recorder, controller |
| `js/platform.js` | Web-portal SDK adapter (ads, gameplay events) |
| `build-itch.ps1` | Makes `dist/cogwild-web.zip` for itch.io / portals |
| `desktop/` | Electron wrapper for a Windows/Steam build |

See **LAUNCH.md** for the publishing checklist.
