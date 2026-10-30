# Cogwild — project guide (read this first)

Cogwild is a 3D mech-building battle game by **BlueDucky Games** (public contact: theblueduckymc@gmail.com).
You build a mech from parts in the Workshop, then fight online (bots fill empty seats) on land, water and sky.
It runs in the browser (three.js r128, no build step), as a Windows app (Electron) and an Android app (Capacitor),
and on game portals (itch.io, CrazyGames, Poki). The online server is zero-dependency Node.js.

**Live:** https://cogwild.duckdns.org (download page `/download`) · **Code:** https://github.com/TheBlueDucky/CogWIld (public; commits as theblueduckymc@gmail.com) · **Current version:** v1.10.1 · **Online protocol:** `cogwild-net-11`
The user is not a programmer: explain things in plain words, test everything yourself, and show screenshots as proof.

## How the user wants things done
- **Tests are always muted** and run in hidden (offscreen) Electron windows (`tests/`). Never play the game with sound,
  never use a visible browser tab for the game (they once heard music from a background test and were upset).
- Tell them before anything that changes the live server; then deploy, rebuild the apps and confirm the downloads.
- Never commit `android/keys/` (release key + `release.properties`); never type their passwords/keys anywhere.
  For secrets, write a script they run themselves (e.g. `deploy/set-login.ps1`).
- The game never pauses (website/exe keep music + game running when unfocused); on phones music stops in the
  background but the match keeps going.
- **Look & feel they asked for:** one calm dark-blue theme (`--bg1 #121a33`, `--bg2 #1a2342`), cyan highlights
  (`--hl #5ce1ff`), PLAY button dark cyan, buttons with the same background as around them and a thin line (no glow,
  no fat outlines, no bright fills), menu titles gray-blue (`--muted2 #9fb3d9`) in sentence case and not too bold,
  dark text fields (`color-scheme: dark`), less rounded corners (`--rad 10px`), a cyan outline on hover for clickable
  buttons (not PLAY, not settings rows: their text turns the title gray-blue `--muted2` on hover), no gold/yellow focus outlines,
  Esc closes any menu/pop-up (also the Workshop, and cancels a match search). No hover text on anything (no `title=`; use `aria-label`).
  v1.9.4 look: calm `.pill` buttons (Clubs), the PLAY picker (`.pick2`: 4 special cards, modes, arenas, gadgets, "More ways to play"
  cards) hovers with the gray-blue `--muted2` line, not cyan; pop-ups (`.note`) have a quiet line, no bright blue frame; the
  Gallery button is 🌍; extra animations (lobby buttons pop in, icons hop on hover, PLAY shines, picks bounce, parts pop in).
  Shop cards are clickable as a whole (gray-blue `--muted2` outline all around on hover) and ask "Buy it?" first.
  Shop, Cog Pass (sideways tier track, Brawl Stars-like; mouse-drag scrolls it) and Settings (a button per category) are full screens.
  The chat on PCs is a panel down the whole left side that doesn't move (`body.talk-dock`, v1.9.4, like a launcher's friends list);
  on phones it's small and see-through (⠿ drags it, settings.chatPos), and in the menu it opens full screen (☰ Menu = back),
  goes upright while typing and fits above the keyboard (`talk.fitKeyboard`, Android: MainActivity pads the view by the IME inset). No ready-made lines except for "Quick chat only" (and the Match tab).
  The party card has its own mini chat (PC: type there; phones: tap = full-screen party chat). 💬 🎤 🎧 (#hudTalk) show in matches,
  while waiting for one and on results; above the touch layer. Voices play through WebAudio PannerNodes (HRTF): in a match from
  that player's mech/pilot, heard from the camera; otherwise straight ahead. Android app: voice uses the loudspeaker
  (CogwildNative.setVoiceAudio).
  Players' own pictures and club pictures are circles; "Quick chat only" players see the default pictures instead. Since v1.9.5 the
  avatars are 8 default pictures (`CW.AVATARS`: a robot head on a colored circle, inline SVG `.dpic`; old `av` numbers wrap `% 8`),
  nothing to buy: the emoji avatars left the Shop, the Trophy Road (those steps pay their price in coins, the steps keep their order)
  and the Cog Pass (coins); wallets that owned some got their price back once (`wallet()` → `avBack` note, `E.OLD_AVATARS`).
  Profile (v1.9.5): banner (`heroHtml`), picture picker (your own picture is only changed/removed with its own buttons; a default
  over it asks first via `meta.ask`), stats 5 × 3 (`.pf-stats`, 15 stats). Account rows live in Settings › Account (`accountHtml`/
  `bindAccount`, `#setAcctBox`, `.set-btn` minimal buttons). Other players: `playerPanel` (banner with online ring, 4 number cards,
  club + "Playing since"). The match status panel is small and see-through (CSS "v1.9.5").
  v1.9.7 (CSS block "v1.9.7"): every button hovers with the gray-blue `--muted2` line (not cyan); action buttons (Save, Send, Add)
  = light blue text on the plain gray line, no fill; club boxes/buttons/fields have no fill, only a line (`.pill.line` = Direct Message);
  Settings categories square at the far left; Settings buttons equal width; no browser pop-ups anywhere (`meta.ask`).
  Club: Club chat under the club card, members show "Online" / "Last online … ago" (`CW.ago`, server `seen`), 📞 Call + Direct
  Message; the owner renames the club (clubEdit `name`) and clicks the picture for Change / Reset picture (`#clPicMenu`).
  Chat: a click outside closes it (`settings.chatStay` keeps it open); chat/voice keys can be two keys (`'ShiftLeft+Tab'`:
  `CW.keyHit`, `CW.keyPart`, `CW.bindName` in meta.js); rooms waiting for their match have free chat (`roomSay` → `roomMsg`,
  accounts only, not for "Quick chat only" readers; `#lbForm` on the room screen). HUD box slider `settings.hudBg` → `--hudBg`.
  Calls (`js/calls.js`, server talk.js `callStart/callAnswer/callEnd`, 30 s ring, friends or club-mates, never blocked): a card at the
  top (Accept / Decline; in a call a bar with the time, 🎤, hang up); a live call counts as voice context; ringtones are WebAudio
  (`CW.RINGTONES`) or your own file (localStorage `cogwild.ringtone`, ≤1.5 MB), `settings.ring/ringVol`. Voices in matches: no
  distance falloff (rolloff 0), equal-power left/right only; game sounds duck to 55% while someone talks (`game.setDuck`).
  Fullscreen button: desktop app → ipc `fullscreen` (window, same as F11); browser F11 can't be left by script (toast).
  v1.9.8 (CSS block "v1.9.8"): Settings order account, display, keybinds, controls, touch, voice, sound, chat, online, support,
  help, save, news; every Settings button / drop-down / checkbox hovers with the `--muted2` line and its row's words turn
  `--muted2` (div rows too); buttons in rows are 32 px like the drop-downs; focus = `--muted2` everywhere. `CW.ICON.phone/mobile/pad`
  (parts.js) = blue SVG icons (calls, Touch screen, Controls); `toast(msg, ico)`. Glass look `settings.glass` → `html.glass`
  (backdrop-filter on lobby buttons/cards, chat, call card, toasts, Settings window; HUD boxes scaled by `--hudBg`).
  `settings.hudBox` (null = `CW.hudBoxDefault`: 50%, 85% with glass) → `--hudBg`. `settings.fpsCap` (null = VSync, a number, 'off'):
  `game.frameMs` skips refreshes in `loop()`; the desktop app turns Chromium's VSync off from the next start
  (`userData/cogwild-app.json`, ipc `vsync` + `restart`; Settings asks first). Emails show as `CW.hideEmail`. Ringtones:
  `ringHtml/bindRing` in meta.js, `calls.preview(id, mine)` / `stopPreview` (plays twice, own file ≤ 8 s, never loops). The call
  card drags (`calls.pos`, ⟲ `#ccReset`; a new call resets it). Clips / replays: `CW.saveFile(kind, name, blob)` (js/desktop.js) →
  desktop/files.js writes Documents\Cogwild\Clips|Replays (only .webm/.mp4/.cwreplay); every match's replay is saved there too;
  `CW.openFolder`. Browsers download as before.
  v1.9.9: the slider is "Background opacity" (`settings.hudBox`): `--hudBg` = the value (match boxes), `--bgK` = value / default
  (lobby buttons/cards and the small match buttons, normal and glass: 0 = no background/glass, 1 = their usual look); chat, call
  card, toasts and pop-ups keep a fixed background. Glass Look sits under it; the Settings categories have no background of their
  own. `CW.ICON.pad/mobile` are white-gray (`.cw-ico.lt`, gradient `#cwLt`). `settings.discord` (default on) → desktop.js sends
  `{ hidden: true }` → discord.js clears the activity. Club / party chat read time is kept on the account too (`chatSeen`
  → `u.chatSeen`, sent back in `talk.seen`), so read stays read on every device.
  v1.9.10 (CSS block "v1.9.10" replaces v1.9.9's --bgK): normal look "Background opacity": alpha = base × `--bgLo` + rest ×
  `--bgHi` (0 = nothing, html.bg0 also drops lines/shadows; default = usual look; 1 = solid). Glass Look "Glass look strength":
  blur / edge × `--gK` (value / default), white tint × `--gK2` (its square) so weaker glass gets clearer, not gray. Brawl Stars-like, but not a copy. Must fit phones (Galaxy A57 sideways
  ≈ 915×412; also check 780×350).
- **Driving (v1.8, they asked for it):** mechs drive like racing-game cars: A/D steer (`inp.manual`: the wheel turns in
  smoothly and snaps straight on release), front wheels visibly steer, S brakes then reverses, the body leans in turns.
  The view turns only by exactly what the player's own steering turned the mech (`mech.camFollowYaw`, applied in
  `updateCamera` the same frame), so letting go of A/D never moves the aim. Auto-steer (W drives toward the view) is off
  on PCs and on for touch screens (`settings.carSteer` migration in meta.js). Budget 500 Bolts, at most 150 parts (`ECON.BUDGET`, `MAX_PARTS`; Rush 300; was 750 in v1.8.0-1.8.4: big builds were too heavy for phones).
  Effects they asked for: thin tracer bullets with a gunshot sound (not big white balls), no muzzle flash right in front of
  your own camera, broken parts fly off smoking, a wreck falls apart and explodes 0.28 s later (`fx.later`). Menus, screens,
  PLAY and the countdown animate (CSS block "v1.8 animations"); the Workshop is calm and flat (block "v1.8 Workshop").
- **v1.8.2 additions they asked for:** Shop kinds `finishes` (`profile.finish`, sent online as `bp.fin`, applied by
  `CW.buildPartMesh(t, team, fin)` → `CW.finishMat` to every part painted in the team color; Rainbow animates via
  `CW.tickFinishes`) and `wrecks` (`profile.wreckFx`, `Fx.wreckFx`, only the shooter sees it). Repairs (hold R) rebuild a
  whole mech in ~4 s whatever its size. A flying mech in the air shows "Hold Space to climb · C to fly down" (`#flyHint`).
  Support: Settings › Support and the top of Help (email theblueduckymc@gmail.com, `meta.supportHtml`). Particles are soft
  sprites (additive glow; smoke/spray normal), the hit flash lights only the part that was hit.
- Lobby layout: left = Shop, Workshop, Achievements, Replays; right = Friends, Clubs, Leaderboard, Gallery (v1.9.6 on PCs: Help and
  News moved to Settings › Help / Change logs at the bottom, the Trophy Road opens from the trophy bar and the challenges from the
  challenge card, both with their badges; phones (`html.compact`) keep all the buttons in 2 columns). Top-left chip = Profile;
  bottom-left = party card (on PCs no leader line and 2 chat lines, so it fits under the buttons), Cog Pass bar, one challenge;
  bottom-right = featured chip, mode/arena card, PLAY. `.lobby-bottom` and `.lb-left` don't catch clicks, only their cards do
  (they used to cover Gallery/News in a party; `tests/party-click-test.js`). Settings › Keys is called Keybinds.

## Files
| Path | What |
|---|---|
| `index.html` | all screens + all CSS (later style blocks override earlier ones: "v1.4 look", "v1.5 theme", then lobby/phone blocks near the end of the first `<style>`) |
| `js/economy.js` | **shared with the server**: shop catalog, deals, Trophy Road, Cog Pass seasons, weekly events, Ranked, levels/XP, part costs/levels/HP/DPS, mech rules (`mechProblem`), daily challenges, achievement rewards. Change prices/rewards here only. |
| `js/featured.js` | shared: today's featured mode + arena |
| `js/parts.js` | part definitions + meshes (Body parts: body, plate, nose, cabin, fender, spoiler, lights, exhaust; `wheel`/`bigwheel` with `radius`, big wheels reach below their cell: `s.bottom`), shapes `CW.STYLES` + turning (see "v1.9.4 Workshop"), presets (Scout Buggy, Monster Truck, Street Racer…, Round Coupe, Jet Fighter, Submarine), `CW.analyze/validate`, `CW.VERSION`, `CW.esc`, `CW.timeLeft` |
| `js/game.js` | the game: modes table (`MODES`, `FORMATS`, `CW.MM_FORMAT`), lobby + lobby stage (party/searching mechs), match loop, bots (`botAim` = human-like aiming), camera (stays out of walls), HUD, results, Esc handling (`closeTop`), touch aim assist |
| `js/entities.js` | mechs, pilots, physics (walls block instead of lifting you), projectiles, fx |
| `js/modes.js` | objectives: King of the Hill, Gold Rush, Combat Race, Boss Battle, Bounty Hunt |
| `js/world.js` | 8 arenas (heightfield functions): canyon, isles, volcano, desert, swamp, city, jungle, scrap |
| `js/net.js` | online: rooms, matchmaking, sync (host runs bots/rules; each player runs their own mech), host migration, spectating |
| `js/account.js` | login/sign-up box (Google in the player's browser: `startGoogle`), wallet (server coins), Cog Pass panel, clubs, friends, party, Trophy Road, leaderboard |
| `js/talk.js` | the chat window (💬 / Enter): Match (quick chat only), Party, Club, Friends (private messages); tap a name: profile / block / report |
| `desktop/files.js` | the desktop app saves clips and replay files into Documents\Cogwild\Clips / Replays and opens those folders (v1.9.8) |
| `js/calls.js` | calls between friends / club-mates (v1.9.7): ringing card, ringtones (built-in or your own file), in-call bar |
| `js/voice.js` | voice chat (WebRTC audio, through the server's TURN relay): only joined in a party (or a room when hearing "my match"), mic opened only while unmuted/undeafened; push-to-talk B, mute M, deafen N (any can be "No key"), devices, the first-time "Use voice chat?" question |
| `js/pics.js` | picking your own / your club's picture: square cropper (shown as a circle), sends a 256×256 JPEG |
| `js/meta.js` | shop, challenges, settings, panels, the PLAY panel (modes/arenas/weekly/ranked/gadgets), What's new |
| `js/supers.js`, `js/gadgets.js` | supers (X) and gadgets (G, 3 uses); bots pick their moment (`Supers.botWants`) |
| `js/replay.js` | match replays: `Recorder` (10 Hz frames: positions, aim/fire, part bits, wrecks, supers, gadgets, feed) into IndexedDB `cogwild-replays` (last 12 + starred), the viewer (state `'replay'`, own part meshes, fx-only shots, follow/orbit/free camera, timeline, speeds, .cwreplay files) |
| `js/gallery.js` | the mech gallery screen (cards drawn by a small renderer, turning 3D close-up, like/copy/try/report, 🌍 Share); "Try it" = test drive with `game.galleryTry`, `leaveTest()` comes back |
| `js/i18n.js`, `js/lang/*.js` | languages: `KEYS` (English with `{n}` for numbers, no leading emoji) + one array per language in the same order; translates text nodes/aria-label/placeholder as the DOM changes; skips `[translate=no]`, `#chat`, `.fr-name`, gallery names; `ar`/`he` add `html.rtl`. Built by `tools/i18n` (see "v1.9 systems") |
| `js/touch.js` | phone controls (right-thumb arc, up/down by the stick, Exit needs a hold) |
| `server/server.js` | HTTP + WebSocket server, rooms, matchmaking (`quick`, kinds weekly/ranked), result checks, mech checks, spectating, security headers/CSP |
| `server/filter.js` | chat filter: bad words (English + Hebrew, also disguised) -> ****, links/emails/phone numbers/social handles -> [hidden]; used for typed chat and club descriptions, refuses usernames and club names |
| `server/pics.js` | own profile + club pictures: square JPEGs ≤64 KB in DATA_DIR/pics, served at `/pic/u/<name>.jpg`, `/pic/c/<id>.jpg` (`pv` = version) |
| `server/gallery.js` | shared mechs in `db.gallery` (legal mechs, filtered names, 12 per account, likes/copies once each, 3 reports hide one) |
| `server/admin.js`, `admin.html`, `js/admin.js` | the moderation page `/admin` (needs `ADMIN_TOKEN`, made by `deploy/set-admin.ps1`): reports, mute, ban, forced quick chat, dismiss, hide/show/delete mechs, 📈 Stats and 🐞 Bugs tabs; 5 wrong keys lock it 15 min |
| `server/support.js`, `support.html`, `js/support.js` | the support page `/support` ("Contact us" in Settings › Support / Help): Google sign-in in the browser (same secret flow as the game; auth-done.js comes back when sessionStorage `cw.support.s` matches), then a message → `db.support` (500 kept, 5 per email a day, 20 per network an hour) → /admin › ✉ Support with "Answer in Gmail" (opens Gmail's compose page in the browser, not the PC's mail app). No Google: Gmail compose link |
| `js/desktop.js`, `desktop/preload.js`, `desktop/discord.js` | desktop app only: `CW.titleBar(h)` (the game's own dark title bar; main.js uses `titleBarStyle: 'hidden'` + `titleBarOverlay`, hides it in fullscreen; `#app` moves down by `--tbh`, `game.view`/`measure()` = the game's area) and the Discord status (preload `CogwildDesktop.presence` → ipc → discord.js talks to Discord's local pipe; `APP_ID` = the user's "Cogwild" Discord application 1565017370466975785, made 28 Oct 2026; its App Icon is the logo). main.js also allows only mic/fullscreen/pointer lock/clipboard (never camera or location) |
| `server/stats.js`, `js/bugs.js` | players per day (`db.stats`: counts, platforms `hello.plat`, modes from `earn` match `mode`/`on`, came-back-next-day/week from per-day player codes) and automatic bug reports (`db.bugs`, grouped by message+place, scrubbed of emails/links/ids, 20 per connection, kept on the device while offline) |
| `server/talk.js` | typed chat (DMs in `db.dms`, club chat in `db.clubChat`, both deleted after 7 days; party lines in memory; DMs between friends or club-mates), Quick chat only (`u.cm`), block (`u.blocked`), reports (`db.reports`), voice peers + signaling, TURN logins |
| `auth.html`, `js/auth-done.js` | the page Google sends players back to (`/auth/google/done`); posts the token to `/auth/google/finish` |
| `server/accounts.js` | accounts + JSON DB (`db.users`, `db.guests`, `db.clubs`), wallet (coins/XP/unlocks/pass), email/Google login, friends, parties, clubs, trophies, Ranked |
| `server/referee.js` | checks every match message: hits only from whoever controls the shooter, damage capped by the mech's weapons, speed and "ignores damage" notes |
| `server/mailer.js`, `server/google.js` | SMTP login codes; Google ID token checks |
| `server/selftest.js` | ~230 server checks (fake SMTP + fake Google keys), incl. chat, voice set-up and browser Google sign-in |
| `tests/` | muted Electron game tests + live checks, see `tests/README.md` |
| `deploy/` | `setup.sh` (installs on the VM), `setup-turn.sh` (voice relay, coturn), `upload.ps1`, `backup-offsite.sh`, `watchdog.sh`, `set-login.ps1` (email codes), `set-google.ps1` (Google client ID) |
| `build-apps.ps1`, `build-itch.ps1` | Windows exe, Microsoft Store appx (`-StoreId/-StorePublisher`), Linux tar.gz (x64+arm64), macOS zips (Intel+Apple Silicon, unsigned, packed on Windows by `desktop/pack-unix.py` from Electron's official Mac zip), Android apk/aab (`-Upload` puts the downloads on the server); portal zips + `dist\itch\` upload folder (`-Portal all`) |
| `desktop/make-icons.js`, `desktop/build/appxmanifest.xml` | Store tiles + Mac .icns from build/icon.png; the appx manifest template (adds internet + microphone) copied into electron-builder before building |
| `desktop/`, `android/` | Electron and Capacitor projects (`android/keys/` = release key, never commit) |
| `README.md`, `LAUNCH.md`, `STORE_PAGE.md` | player-facing readme, store/launch steps, store texts |

## How it works (short)
- **Online model:** the room's host game runs bots/rules/objectives and reports results; each player's game runs its own
  mech and decides its own shots. The server checks what it can: random host each match, result plausibility
  (`resultProblem`), the referee, mech checks against the player's **server** level and the budget (on `ready` and on
  `begin`), host migration if the host quits or goes silent for 6 s. Not done: a full server-run simulation (big rewrite).
- **Economy:** every player has a server wallet (accounts in `db.users[k].w`, guests in `db.guests` keyed by a device
  token). The game only shows it and asks: `earn` (capped per kind, per playing time, per day), `buy`, `gift`,
  `roadClaim`, `passClaim`. Prices and rewards come from `js/economy.js` on both sides.
- **Login:** with `GOOGLE_CLIENT_ID` set, sign up and log in = Google in the player's own browser: the game makes a
  secret, opens `/auth/google?s=<secret>` (Android: `CogwildNative.openUrl`, Windows app: new windows go to the browser),
  Google returns to `/auth/google/done` (implicit id_token + nonce), that page posts the token, the server logs in the
  waiting game (`googleStart`/`googleDone`); new players then pick a username (no password). Older accounts: email or
  username + password behind a link. Without Google: email + password + username sign-up (`acctSignup`; a 6-digit code
  when mail is configured). Nobody has to log in: guests play with progress on their device (plus the guest wallet) and get a
  "Playing as a guest" card at most once a day (account.js guestNudge) with Log in / Sign up.
- **Chat/voice:** matches = quick chat only (keys 1-8); friends/party/club = free text (200 chars, filtered by `server/filter.js`) or
  quick lines (`TALK_QUICK` in economy.js). "Quick chat only" (kids) is per account and also turns voice off. Voice needs an
  account; peers = same party, or same room when both chose "my match"; always via the TURN relay (no IPs shared). Free
  chat is off on CrazyGames/Poki and voice is off on every portal (their frames block the mic). The game asks "Use voice chat?" on first start, after each update and per account.
- **Social:** friends, parties of 4 (party mechs shown on the lobby stage), clubs (30, club wall), watch a friend's match.
- **Modes/content:** 8 modes (Rush Build, Workshop Clash, KOTH, Gold Rush, Bounty Hunt, Combat Race, Survival, Boss),
  8 arenas, supers, gadgets, daily featured event, weekly events with modifiers, Ranked (100+ best trophies),
  Cog Pass (30 tiers per 4-week season), Trophy Road, 6 daily challenges, achievements.

## v1.10.1 (30 Oct 2026, same NET_VERSION)
- **Arenas**: no picking any more (PLAY panel, arena card): `CW.FEATURED.arenasFor(mode, have)` / `MODE_ARENAS` (featured.js, shared) =
  the arenas a mode fits; offline `beginMatchState` and online `net.resolveSettings` pick one at random; the server's `quick` always
  uses 'random' (one queue per mode). Featured today = a mode. `game.arenaRoll()` = the roulette overlay (#arenaRoll) before the
  countdown (countdown = 3.5 + its length; the number shows only under 3.6). `CW.ARENA_COLORS` for its cards.
- **Mech Ball Stadium** (`stadium`, world.js `CW.STADIUM` {L 104, W 66, goalW 13, goalD 12, y 4}): flat pitch, walls, goal pockets,
  floodlights; only for ball (and derby). MechBall (modes.js): real goals (posts/crossbar/net), sub-stepped ball physics with wall
  bounces off the terrain's slope, mech hits by relative speed (`touch`), shots push it (`ballHit`), clients run the same physics and
  follow the host (`target`, `netRate` 0.1 → net objT), teams line up in their halves (`spawn`). No chests or pads in ball.
- **Mouse steering** (`settings.mouseSteer`, default on, not on touch): the mech turns to `cam.yaw`; the view is clamped to 0.9 rad of
  the mech's nose (updatePlayer).
- **Bots**: `js/botmechs.js` `CW.botMech(budget, domains, { noBoats, kind })` builds car/truck/rammer/walker/heli/plane/boat mechs
  (validated, must move); 75% of bots use one. Dodging: `updateBot` judges each incoming shot once (`p.seen`), dodges with chance
  0.15 + 0.45 × smarts (`ai.dodgeT`). Supers/gadgets: fallbacks after waiting (`superWait`, `gadWait`).
- **Collisions**: `game.collide` shares overlap and a bounce impulse by mass.
- **Economy**: loadout prices ×~3, cosmetics ×1.5, match coins = xp/5 + bonus/2, `EARN.match` 400, server cap 25 + gap × 2.5,
  `EARN_PER_DAY` 4000, smaller in-match bonuses and chest coin piles.
- **Power Cell** (`js/reveal.js`, server `cellOpen`, economy `cellLevel/cellReward`): the results screen's reward (uses the old
  results crate's once-per-match flag). Levels 1-5 (20% … OVERLOAD), chances `CELL_UP`; rewards coins / XP / pass points / an unowned
  paint, trail/finish/wreck, or super/gadget/perk. `grant` handles supers/gadgets/perks keys.
- **Reveal** (`game.reveal.show(title, items, sub)`, `items(reward)`): daily gift, challenges, Trophy Road, Cog Pass (Claim all = one),
  event track, Weekend Cup, Shop purchases. Tap/Space/Enter = next, Esc = close.
- Fixes: `account.applyWallet` keeps owned supers/gadgets/perks; the guest card is removed when a match starts; stadium keeps event
  decor off the pitch.
- Test: `tests/v1101-test.js`, shots `tests/v1101-shots.js`.

## v1.10 gameplay update (30 Oct 2026, NET_VERSION cogwild-net-11)
- **Loadout** (`js/loadout.js`): `SHOP.supers / gadgets / perks` in economy.js (price 0 = free; `need`: part list or 'land'/'water'/'air',
  `E.fits`). Wallet `owned.supers/gadgets/perks`; `E.cleanLoadout` + `accounts.loadout(c, lo)` strip unowned ones on `ready` and `begin`.
  `bp.lo = { sp, gd, pk }` travels in blueprints (`CW.cloneBp` keeps it, `CW.cleanLo`); each combatant has `c.lo` (player: `CW.myLoadout`
  from `settings.loSuper` / `gadget` / `loPerks`, bots: `CW.botLoadout`). `mech.mods` (`CW.mechMods`) = perks + part combos (`CW.COMBOS`):
  hpK, dmgK, speedK, airK, waterK, rateK, ramK, dashK, splashK, absorb, repairK, regen, ramAll. Referee allows HP up to ×1.45.
  Shop sections + `meta.loCard/equipLo/loEquipped`; the PLAY panel's Loadout (`.lo-chip`); Workshop shows combos.
- **Supers** (supers.js, 12): new orbital, overdrive, gravity, slam (+'slamhit' event), inferno, swarm, lance, tidal; `fields` = lasting ones;
  `aimSpot(m, max)`; events carry `at`. **Gadgets** (12): grapple, bubble, decoy, sonar (`game.sonarUntil` → red tags through walls),
  empnade (projectile 'grenade'), nitro (`m.nitroT`), torpedo, afterburner (`m.burnerT`); `botWants`. Gadget Belt = 4 uses.
- **Weapons** (new part types): mortar (high lob), harpoon (projectile 'hook' + chain, pulls), tesla (`fx.tesla`, chains), magnet (`fx.magnet`).
  Pushes/pulls/jams: `game.kick(m, v, who, jam)` → net event 'kick' (referee: shooter must be owned, |v| ≤ 60).
- **Core weak spot**: hits on the core ×1.4 (decided by the hitting game, `game.critT` → yellow ✸ numbers). `hit(part, dmg, who, kind)`:
  kind 'ram' (Shock Absorbers). Streaks without dying (`c.lifeStreak`, `game.streaks`: SHUTDOWN bonus), killcam (`startKillcam`, respawn
  modes and pilot eliminations), comeback (`game.behind(team)`: 30% behind → supers ×1.35).
- **Chests** (extras.js): hold O (`CW.CHEST_HOLD` 1 s; Treasure Hunter ÷3) next to one, `#chestHint`; bots wait next to it; online clients
  send 'openReq' (host checks distance). They're ×1.35 bigger and throw `CW.Loot` items (coin piles, power-up orbs, 'charge' super +35%,
  'gadget' +1 use): host events 'loot' / 'lget'. Scavenger perk drops a repair orb. Keys: KEY_ACTIONS 'open' (KeyO), 'ping' (KeyZ);
  gamepad d-pad down = O, right stick = Z; touch 🎁 (only near a chest) and 📍.
- **Hazards** (`js/hazards.js`): boost / jump pads (seeded by arena id, each game launches its own mechs), arena events every 80-110 s
  (host 'hz' event with strikes [x, z, delay]; each game hurts only its own mechs; sandstorm = `fogNear/fogFar`, blackout dims lights).
- **Pings** (`js/pings.js`): tap Z = smart ping, hold = wheel (Attack/Defend/Help/Careful), event 'ping', team only; allied bots follow
  (`ai.pingGoal/pingT`, `ai.target` for enemy pings).
- **Modes** (modes.js): `heist` CoreHeist (bases = `game.teamBases`, carrier `c.carrying` ×0.8 speed), `ball` MechBall (host physics,
  `ballHit(p)` from projectiles), `derby` (no objective, `noGuns`, everyone rams: `game.ram`), `scrap` ScrapWars (extends GoldRush,
  `onPart`, `c.scrapLv` = damage/armor/speed). Objectives may have `urgent(c)` (bots go even with enemies near) and `takeOver()`.
  Server `MM_FORMAT` / `cleanSettings` list them; derby counts as last-standing in `resultProblem`.
- New challenges: super, heist, goal, pad (rollChallenges re-rolls when an update changes today's list, keeping matching progress).
- Test: `tests/v110-test.js` (all of the above, offline + one online Core Heist).

## v1.9 systems (Oct 2026)
- **Seasonal events** (`ECON.EVENTS`, `event(now)`): Halloween 20 Oct–3 Nov, Winter 10 Dec–6 Jan, Valentine's 7–16 Feb, Spring 20 Mar–20 Apr,
  Summer Jul–Aug. World decorations (`World.buildEventDecor`, instanced), event particles, Halloween nights; server counts event points
  (`w.ev`), 4-step track (`eventClaim`); event items have `event:` and are never sold / never on the Road or in deals. `EVENT_DATE` env = tests.
- **Weekend Cup** (`ECON.cup()`): Fri 18:00 → Mon 00:00 UTC, one mode, `cupPoints(place, n)`, best 10 count, `db.cups` (last 4), queue kind
  `'cup'` (accounts only), `cupResult`/`cupInfo`/`cupClaim`; top 3 get the `cup_champ` trail. `CUP_DATE` env = tests.
- **Arenas + rotation**: `speedway`, `bay`, `moon` (`grav: 0.5`, `space: true`). `FEATURED.rotation()` = 5 arenas per 3 hours for Any arena.
  Games send `arenas` in `hello`; older games = `FEATURED.CLASSIC`; the server only matches games into rooms whose arena they have and sends
  `room.arenas` (what everyone has); the host picks only from those. New arena ids therefore need no NET_VERSION bump.
- **Bots**: look-ahead steering (`botClearYaw`), circling, fleeing when hurt, reversing out, dodge dashes, victory donuts (`ai.smarts` by difficulty).
- **Kids safety**: 3 different chat reporters in 24 h → typed chat muted 24 h automatically (`u.muteUntil`, `autoMuted`); `banUntil` refuses login.
- **Stats + bug reports (v1.9.2)**: a player = one short one-way code per day (`u.sid` keeps it across renames and guest → account); no names in
  `db.stats`. Games send `{ t: 'bug' }` by themselves (window errors, unhandled promises, the crash screen); add-on/portal-script errors are skipped.
  Both show on /admin (turned on 27 Oct 2026: the user ran set-admin.ps1; the key is theirs, never ask for it). New things shown to players there must stay listed in privacy.html and STORE_PAGE.md "Data safety".
- **Languages**: texts live in `tools/i18n/` (`i18n_keys.py` + one `i18n_<id>.py` list per language, same order, same `{n}` count, and the
  engine `i18n_engine.js`). After editing: `python tools/i18n/i18n_check.py es fr …` then `python tools/i18n/i18n_build.py` (writes js/i18n.js and
  js/lang/*.js). `tests/i18n-extract.js` lists what the game shows. Long Help/News texts stay English.

## v1.9.4 Workshop (Oct 2026)
- **Shapes** (`p.s`): other looks of a Body part (`CW.STYLES`: body:edge/curve/corner/dome/slope/tube, nose:cone, cabin:canopy/tower,
  spoiler:fin). Same cost/weight/HP as the part, so the server and older games treat them as that part (old games draw the plain one):
  **no new part types, no NET_VERSION bump**. The part list shows them under their part (`CW.pdef(id)`, ids like `'body:edge'`).
- **Turning** (`p.r`): 0-3 quarter turns from above, +4 upside down (`CW.turnMesh`); only `CW.canTurn` parts (Structure, Body, Decor,
  wing, float, shield): wheels/weapons/movers always face forward. R / Shift+R / U, ⟳ Turn / ⇅ Flip. Mirror copies use `CW.mirrorTurn`.
- Every place that draws or passes parts keeps them: `CW.partMesh(p)`, `CW.cleanPart`, `CW.partArr`/`partFromArr` (codes, gallery,
  replays: `[t, x, y, z, r, s]`), net `safeBp`, server `E.partLook` (server.js cleanParts, party mechs, gallery).
- Flying: `ROTOR_LIFT` 14 (was 10), `WING_LIFT` 1 (was 0.7), so armored mechs fly.

## Server (Oracle Cloud)
- VM **DuckysSrv**, **il-jerusalem-1** (home region: Always Free A1 + the free 200 GB boot volume; moved from paid
  Ashburn on 24 Oct 2026), **reserved** IP **84.13.68.152** (never changes), Ubuntu, also runs their Minecraft servers.
  SSH: `ubuntu@84.13.68.152` with `C:\Users\tomer\OneDrive\Desktop\OracleServer\ssh-key-2026-10-21.key`.
  OCI CLI: `~/bin/oci` (home region is the default). Don't create disks/servers outside il-jerusalem-1: other regions bill storage.
- Service `cogwild` (127.0.0.1:8765) behind nginx + Let's Encrypt for `cogwild.duckdns.org`. Data: `/opt/cogwild/data/db.json`
  (daily copies in `data/backups`), downloads in `/opt/cogwild/downloads`. Optional settings in `/etc/cogwild.env`.
- Upkeep: cron `/etc/cron.d/cogwild` runs the watchdog every 2 min and the off-server backup nightly (bucket
  `cogwild-backups`, write-only link in `/etc/cogwild-backup.url`). Oracle alarm "DuckysSrv is down" emails the user.

### Deploy (website + server)
```bash
K="/c/Users/tomer/OneDrive/Desktop/OracleServer/ssh-key-2026-10-21.key"; PACK=/tmp/cogwild-upload.tgz
tar --force-local -czf "$PACK" index.html auth.html support.html favicon.svg js fonts img server deploy privacy.html terms.html credits.html download.html admin.html manifest.webmanifest sw.js
scp -q -i "$K" "$PACK" ubuntu@84.13.68.152:/tmp/cogwild.tgz
ssh -i "$K" ubuntu@84.13.68.152 "sudo cp /opt/cogwild/data/db.json /opt/cogwild/data/backups/db-before-X.json; rm -rf ~/cogwild-src && mkdir -p ~/cogwild-src && tar -xzf /tmp/cogwild.tgz -C ~/cogwild-src && sed -i 's/\r$//' ~/cogwild-src/deploy/*.sh && sudo bash ~/cogwild-src/deploy/setup.sh cogwild.duckdns.org"
```
(`deploy\upload.ps1` does the same but stops early in PowerShell because nginx prints to stderr.)
Then: `node --experimental-websocket tests/live-smoke.js`.

### Apps
```powershell
& C:\Users\tomer\cogwild\build-apps.ps1 -Upload -Ip 84.13.68.152 -Key "C:\Users\tomer\OneDrive\Desktop\OracleServer\ssh-key-2026-10-21.key"
& C:\Users\tomer\cogwild\build-itch.ps1 -Portal all
```
Delete the previous version's files in `dist/downloads` first. Check the live downloads' sizes match afterwards.

### New version checklist
`js/parts.js` (`CW.VERSION`), `index.html` (`?v=` cache busters, all of them), `desktop/package.json` (version),
`android/android/app/build.gradle` (versionCode +1, versionName), `download.html` + `LAUNCH.md` (file names),
What's new in `js/meta.js`. Raise `NET_VERSION` (`js/net.js`, `server/server.js`, `server/selftest.js`) only when old
apps would break with the new server; they then get an "update" prompt.

## Gotchas learned the hard way
- Bash heredocs with backslashes or `'` inside Python break; write the script to a file (scratchpad) and run it.
- `tar` on Windows paths needs `--force-local`.
- Never zip with `Compress-Archive` (Windows PowerShell 5.1): it stores `js\economy.js` with backslashes, and Linux hosts (itch.io,
  portals) unpack that as one odd file name, so the game sticks on "Building the arena…". build-itch.ps1 uses .NET ZipFile with `/`.
- Phones: Android's Back button/gesture calls `CW.onBack()` (MainActivity OnBackPressedCallback; like Esc: closes a menu, opens/closes the match menu, goes back a screen; 'exit' only from the main menu → app to background). The touch HUD's menu button reads "☰ Menu". `#testBar` lives at the top level of #app (z 6) so the touch look layer (#touch, z 4) doesn't swallow taps; HUD buttons inside #hud are under it.
- Mouse pointer in matches (v1.9.1): `game.lockMouse()` (clicks, any key, resume, match start; browsers need a fresh click/key), `html.aiming` hides the
  pointer over the canvas even when the lock is refused (`pointerlockerror` → one "drag to aim" tip). Touch "Auto" = `(pointer: coarse)` at start, then
  follows the last press (`Touch.follow`: finger on, mouse off): touchscreen PCs used to get the touch layer over the canvas, so clicks never locked the mouse.
- Mouse speed (v1.9.3): Chrome on some Chromebooks / zoomed screens reports `movementX` × devicePixelRatio. `game.mouseScale` compares movement with
  the pointer's clientX path in the menus and sets `mouseFix` = DPR only when the ratio ≈ DPR; the mousemove handler also drops one huge made-up jump
  (>250 px and >8× the recent average). Synthetic Electron input has movementX 0, so `tests/mouse-speed-test.js` dispatches MouseEvents itself.
- Usernames: `acctRename` (Profile › Change username, once a week, capital letters any time) re-keys the account everywhere (friends/requests/blocked/unread, clubs, DMs + club chat authors, tokens, email map, online, party, picture file).
- Climbing (v1.9.7): ground steeper than a mech's drive slope is climbed on speed (slows you; under 5 m/s you roll back);
  steeper than `CLIFF` 3.2 (~73°) is a wall face. Cresting fast throws you up (`climbVy`). The force field is `CW.FIELD` 192 (top of
  the edge slopes 166→195); `CW.ARENA_HALF` 176 stays the playing area for spawns/bots/map. Racing into the field = a backflip (`flipT`).
- Bridges: `world.groundAt(x, z, refY)` counts a deck only within 0.9 of `refY` (2.2 near the ends): otherwise anything
  under a bridge popped up onto it. Pilots treat ground rising > 0.5 m within 0.5 m ahead as a wall (no creeping up cliffs),
  and step onto mech parts only up to 0.55 m (jump onto them). Getting out picks a spot at the mech's own height.
- The HUD and menus are CSS-zoomed (`--z`, `game.uiZoom`): anything placed on them from a 3D point (name tags, damage numbers) must use window pixels / `uiZoom`.
- CSP is strict (`script-src 'self'`): no inline scripts or `onclick=` in pages.
- Two Electron windows in one test: create both before destroying either (a fresh window after a destroyed one can fail to load).
- Class names on lobby buttons used to clash with other screens' styles (`.ach`, `.road`): keep side buttons as plain `side-btn`.
- The server's sign-up limit is 5 accounts per network per hour (tests reuse accounts for that reason).

## Waiting on the user
- Google Play "Data safety" form: since v1.9.2 also tick App interactions + Crash logs + Diagnostics (analytics), see STORE_PAGE.md.
- Email sending: run `deploy\set-login.ps1` (Gmail app password or other SMTP; optional Google OAuth client ID).
  Steps are in `LAUNCH.md` > "Turn on email login".
- Minecraft players who joined by the old IP 150.136.43.207 need the new one (84.13.68.152); that address is gone.
- Optional cleanup of old downloads on the server (1.0–1.6.3).
- Confirm the Oracle alert email subscription.
- Store launch: Google Play closed test (12 testers × 14 days), itch.io/CrazyGames/Poki submissions (zips in `dist/`).
- Google Play Data safety: also "Developer communications" for the support page (v1.9.4, STORE_PAGE.md).
- Microsoft Store: **submitted for certification on 24 Oct 2026** (v1.8.3, identity TheBlueDucky.CogWild, Store ID 9P58PTK2Z93L, listing name "CogWild", publisher TheBlueDucky; settings in desktop/package.json). After it's live: add a "Get it from Microsoft" link (https://apps.microsoft.com/detail/9P58PTK2Z93L) to download.html. Each update = higher version + `build-apps.ps1 -Only store` + a new submission (1-3 days); avoid NET_VERSION bumps right before one, Store players can't update until it passes. The Store copy (`process.windowsStore` → `?store=1` → `CW.STORE`) sends updates to its Store page (`CW.STORE_ID`).
- The Mac builds were never tried on a real Mac (built on Windows); Linux arm64 was smoke-tested in Docker on DuckysSrv.
- New parts must also go into `js/economy.js` PARTS (cost, type, level, HP, DPS) or the server refuses mechs with them; adding part types needs a NET_VERSION bump (old games crash on unknown parts).
- Optional: delete the empty "CogWild" Google Cloud project on the personal Google account (made by mistake, no billing).

## Google sign-in (done 23 Oct 2026)
Google Cloud project **cogwild-512516** owned by theblueduckymc@gmail.com (no billing account: free), Google Auth Platform
External + **In production**, support email theblueduckymc@gmail.com, scopes openid + email only (no review needed),
web client "Cogwild game", redirect URI `https://cogwild.duckdns.org/auth/google/done`, Client ID
`763067835148-fvqhbbrbv5ugnb7160aqajm7vhaacgdr.apps.googleusercontent.com` (public, set with `deploy\set-google.ps1`).
The client secret is not used (implicit id_token flow) and was not saved. The built-in browser has both Google accounts
signed in, which makes Cloud Console pages fail to load now and then: Retry, or go through `/apis/credentials/consent`.
