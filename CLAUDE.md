# Cogwild — project guide (read this first)

Cogwild is a 3D mech-building battle game by **BlueDucky Games** (public contact: theblueduckymc@gmail.com).
You build a mech from parts in the Workshop, then fight online (bots fill empty seats) on land, water and sky.
It runs in the browser (three.js r128, no build step), as a Windows app (Electron) and an Android app (Capacitor),
and on game portals (itch.io, CrazyGames, Poki). The online server is zero-dependency Node.js.

**Live:** https://cogwild.duckdns.org (download page `/download`) · **Code:** https://github.com/TheBlueDucky/CogWIld (public; commits as theblueduckymc@gmail.com) · **Current version:** v1.9.3 · **Online protocol:** `cogwild-net-10`
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
  Esc closes any menu/pop-up (also the Workshop). No hover text on anything (no `title=`; use `aria-label`).
  Shop cards are clickable as a whole (gray-blue `--muted2` outline all around on hover) and ask "Buy it?" first.
  Shop, Cog Pass (sideways tier track, Brawl Stars-like; mouse-drag scrolls it) and Settings (a button per category) are full screens.
  The chat is small and see-through (top-left, ⠿ drags it anywhere, saved in settings.chatPos); on phones in the menu it opens
  full screen (☰ Menu = back) and goes upright while typing. No ready-made lines except for "Quick chat only" (and the Match tab).
  The party card has its own mini chat (PC: type there; phones: tap = full-screen party chat). 💬 🎤 🎧 (#hudTalk) show in matches,
  while waiting for one and on results; above the touch layer. Voices play through WebAudio PannerNodes (HRTF): in a match from
  that player's mech/pilot, heard from the camera; otherwise straight ahead. Android app: voice uses the loudspeaker
  (CogwildNative.setVoiceAudio).
  Players' own pictures and club pictures are circles; "Quick chat only" players see the preset avatars instead. Brawl Stars-like, but not a copy. Must fit phones (Galaxy A57 sideways
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
- Lobby layout: left = Shop, Workshop, Challenges, Achievements, Help; right = Friends, Clubs, Leaderboard, Trophy
  Road, News; top-left chip = Profile (stats live in Profile); bottom-left = party card, Cog Pass bar, one challenge;
  bottom-right = featured chip, mode/arena card, PLAY.

## Files
| Path | What |
|---|---|
| `index.html` | all screens + all CSS (later style blocks override earlier ones: "v1.4 look", "v1.5 theme", then lobby/phone blocks near the end of the first `<style>`) |
| `js/economy.js` | **shared with the server**: shop catalog, deals, Trophy Road, Cog Pass seasons, weekly events, Ranked, levels/XP, part costs/levels/HP/DPS, mech rules (`mechProblem`), daily challenges, achievement rewards. Change prices/rewards here only. |
| `js/featured.js` | shared: today's featured mode + arena |
| `js/parts.js` | part definitions + meshes (Body parts: body, plate, nose, cabin, fender, spoiler, lights, exhaust; `wheel`/`bigwheel` with `radius`, big wheels reach below their cell: `s.bottom`), presets (Scout Buggy, Monster Truck, Street Racer…), `CW.analyze/validate`, `CW.VERSION`, `CW.esc`, `CW.timeLeft` |
| `js/game.js` | the game: modes table (`MODES`, `FORMATS`, `CW.MM_FORMAT`), lobby + lobby stage (party/searching mechs), match loop, bots (`botAim` = human-like aiming), camera (stays out of walls), HUD, results, Esc handling (`closeTop`), touch aim assist |
| `js/entities.js` | mechs, pilots, physics (walls block instead of lifting you), projectiles, fx |
| `js/modes.js` | objectives: King of the Hill, Gold Rush, Combat Race, Boss Battle, Bounty Hunt |
| `js/world.js` | 8 arenas (heightfield functions): canyon, isles, volcano, desert, swamp, city, jungle, scrap |
| `js/net.js` | online: rooms, matchmaking, sync (host runs bots/rules; each player runs their own mech), host migration, spectating |
| `js/account.js` | login/sign-up box (Google in the player's browser: `startGoogle`), wallet (server coins), Cog Pass panel, clubs, friends, party, Trophy Road, leaderboard |
| `js/talk.js` | the chat window (💬 / Enter): Match (quick chat only), Party, Club, Friends (private messages); tap a name: profile / block / report |
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
tar --force-local -czf "$PACK" index.html auth.html favicon.svg js fonts img server deploy privacy.html terms.html credits.html download.html admin.html manifest.webmanifest sw.js
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
