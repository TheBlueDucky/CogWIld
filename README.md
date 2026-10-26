# Cogwild

Build any mech, then fight on land, water and sky. A 3D browser game made with three.js: play online with up to 8 players (bots fill empty slots) or alone against bots.

## Run it

```bash
node server/server.js
```

Then open http://localhost:8765. This runs the game **and** the online server, so 🌐 Online works too
(open a second browser window to play against yourself, or let someone on your Wi-Fi join `http://YOUR-PC-IP:8765`).
`py serve.py` still works for single-player only. To put the game on the internet, see [deploy/README.md](deploy/README.md).

## Features
- **Workshop**: snap-together building with 35+ parts (wheels, big wheels, legs, floats, rotors, jets, car body parts, weapons), mirror mode, undo/redo, paint, blueprints with share codes, Test Drive; 500 Bolts per mech
- **8 modes**: Rush Build, Workshop Clash, King of the Hill, Gold Rush, Bounty Hunt (1v1, 3v3, 2v2v2v2 or 8-player free-for-all), Combat Race, Survival and Boss Battle
- **11 arenas**: Canyon Lake, Frost Isles, Volcano Rift, Desert Mesa, Toxic Swamp, Neon City, Jungle Temple, Scrap Yard, Turbo Speedway, Shipwreck Bay and Moon Base (low gravity), each by day, sunset or night; "Any arena" plays the 5 arenas in rotation (every 3 hours)
- **Replays**: every match is recorded on your device; watch with speeds, a timeline and follow / orbit / free cameras
- **Mech gallery**: share your mechs, browse trending / top / new, like, try and copy others'
- **Weekend Cup** (Friday to Sunday), **Ranked**, weekly events, a daily featured event, **seasonal events** (Halloween, Christmas, Valentine's, spring, summer)
- **13 languages**: English, Spanish, Portuguese, French, German, Italian, Russian, Turkish, Hindi, Arabic, Hebrew, Chinese, Japanese
- **Safety**: Quick chat only for kids, a word filter, block and report, and a moderation page for the owner (`/admin`)
- **Fair play**: safe spawns, spawn shield, unstuck key (F), pilots thrown clear of lava
- **Loot chests** on the map, supply drops, and a free reward chest after every match
- **First-person Camera part**, dash, power-ups, pilot on foot, spike rams, sudden death
- **Progression**: levels, ranks (Mono/Hybrid/Omni), part unlocks, coins, shop, daily reward, daily challenges, 26 achievements, stats
- **Interactive tutorial**, clip recorder (F8), controller support, graphics settings (auto-lowers on slow PCs), save backup/restore
- **One PLAY button**: pick an arena on the arena card, PLAY finds a match there; after 30 s bots fill the empty seats. Private rooms with invite links (every mode, co-op Survival and Boss too) and practice vs bots sit behind the arena card. Quick chat.
- **Supers**: deal damage to charge a super (Shield Dome, Turbo Ram, Missile Barrage or EMP Shockwave, depending on your parts)
- **Daily featured event**: one mode + arena a day with 2× coins and +50% trophies; trophy-based matchmaking with bots that scale with the room's trophies
- **Accounts**: username + password, cloud-saved progress on every device, profile with avatars, friends (online status, join their room), parties of 4, trophies with tiers, a Trophy Road and world/friends leaderboards
- **Every platform**: browser, Windows app (.exe) and Android app (.apk) with touch controls; download page at `/download`
- **Settings**: remappable keys, touch controls, music volume, fullscreen, graphics, FOV, sensitivity and more
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
| `js/net.js` · `js/account.js` | Online rooms and match sync · accounts, cloud save, friends, party, trophies, leaderboard |
| `js/touch.js` | Touch controls for phones/tablets (match + Workshop gestures) |
| `server/server.js` · `server/accounts.js` | Game + WebSocket server · account storage, friends, parties, trophies |
| `server/selftest.js` | End-to-end server test (`node --experimental-websocket server/selftest.js`) |
| `build-apps.ps1` · `desktop/` · `android/` | Builds the Windows .exe (Electron) and Android .apk (Capacitor) |
| `download.html` | The download page served at `/download` |
| `build-itch.ps1` | Makes `dist/cogwild-web.zip` for itch.io / portals |
| `desktop/` | Electron wrapper for a Windows/Steam build |

See **LAUNCH.md** for the publishing checklist.
