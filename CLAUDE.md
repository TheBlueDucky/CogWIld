# Cogwild — project guide (read this first)

Cogwild is a 3D mech-building battle game by **BlueDucky Games** (public contact: theblueduckymc@gmail.com).
You build a mech from parts in the Workshop, then fight online (bots fill empty seats) on land, water and sky.
It runs in the browser (three.js r128, no build step), as a Windows app (Electron) and an Android app (Capacitor),
and on game portals (itch.io, CrazyGames, Poki). The online server is zero-dependency Node.js.

**Live:** https://cogwild.duckdns.org (download page `/download`) · **Current version:** v1.6.5 · **Online protocol:** `cogwild-net-8`
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
  Shop, Cog Pass (sideways tier track, Brawl Stars-like) and Settings (a button per category) are full screens. Brawl Stars-like, but not a copy. Must fit phones (Galaxy A57 sideways
  ≈ 915×412; also check 780×350).
- Lobby layout: left = Shop, Workshop, Challenges, Achievements, Help; right = Friends, Clubs, Leaderboard, Trophy
  Road, News; top-left chip = Profile (stats live in Profile); bottom-left = party card, Cog Pass bar, one challenge;
  bottom-right = featured chip, mode/arena card, PLAY.

## Files
| Path | What |
|---|---|
| `index.html` | all screens + all CSS (later style blocks override earlier ones: "v1.4 look", "v1.5 theme", then lobby/phone blocks near the end of the first `<style>`) |
| `js/economy.js` | **shared with the server**: shop catalog, deals, Trophy Road, Cog Pass seasons, weekly events, Ranked, levels/XP, part costs/levels/HP/DPS, mech rules (`mechProblem`), daily challenges, achievement rewards. Change prices/rewards here only. |
| `js/featured.js` | shared: today's featured mode + arena |
| `js/parts.js` | part definitions + meshes, presets, `CW.analyze/validate`, `CW.VERSION`, `CW.esc`, `CW.timeLeft` |
| `js/game.js` | the game: modes table (`MODES`, `FORMATS`, `CW.MM_FORMAT`), lobby + lobby stage (party/searching mechs), match loop, bots (`botAim` = human-like aiming), camera (stays out of walls), HUD, results, Esc handling (`closeTop`), touch aim assist |
| `js/entities.js` | mechs, pilots, physics (walls block instead of lifting you), projectiles, fx |
| `js/modes.js` | objectives: King of the Hill, Gold Rush, Combat Race, Boss Battle, Bounty Hunt |
| `js/world.js` | 8 arenas (heightfield functions): canyon, isles, volcano, desert, swamp, city, jungle, scrap |
| `js/net.js` | online: rooms, matchmaking, sync (host runs bots/rules; each player runs their own mech), host migration, spectating |
| `js/account.js` | login/sign-up box, wallet (server coins), Cog Pass panel, clubs, friends, party, Trophy Road, leaderboard |
| `js/meta.js` | shop, challenges, settings, panels, the PLAY panel (modes/arenas/weekly/ranked/gadgets), What's new |
| `js/supers.js`, `js/gadgets.js` | supers (X) and gadgets (G, 3 uses) |
| `js/touch.js` | phone controls (right-thumb arc, up/down by the stick, Exit needs a hold) |
| `server/server.js` | HTTP + WebSocket server, rooms, matchmaking (`quick`, kinds weekly/ranked), result checks, mech checks, spectating, security headers/CSP |
| `server/accounts.js` | accounts + JSON DB (`db.users`, `db.guests`, `db.clubs`), wallet (coins/XP/unlocks/pass), email/Google login, friends, parties, clubs, trophies, Ranked |
| `server/referee.js` | checks every match message: hits only from whoever controls the shooter, damage capped by the mech's weapons, speed and "ignores damage" notes |
| `server/mailer.js`, `server/google.js` | SMTP login codes; Google ID token checks |
| `server/selftest.js` | ~117 server checks (fake SMTP + fake Google keys) |
| `tests/` | muted Electron game tests + live checks, see `tests/README.md` |
| `deploy/` | `setup.sh` (installs on the VM), `upload.ps1`, `backup-offsite.sh`, `watchdog.sh`, `set-login.ps1` |
| `build-apps.ps1`, `build-itch.ps1` | Windows exe + Android apk/aab (`-Upload` puts them on the server); portal zips (`-Portal all`) |
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
- **Login:** Sign up = email (one account per email) + password twice + username, one step (`acctSignup`); when mail is
  configured, a 6-digit code confirms the email first. Log in = email + password (old accounts can still type their
  username). Forgot password = code by email. Google sign-in when `GOOGLE_CLIENT_ID` is set. When mail or Google is
  configured, the game asks everyone to log in (not on portals).
- **Social:** friends, parties of 4 (party mechs shown on the lobby stage), clubs (30, club wall), watch a friend's match.
- **Modes/content:** 8 modes (Rush Build, Workshop Clash, KOTH, Gold Rush, Bounty Hunt, Combat Race, Survival, Boss),
  8 arenas, supers, gadgets, daily featured event, weekly events with modifiers, Ranked (600+ best trophies),
  Cog Pass (30 tiers per 4-week season), Trophy Road, 6 daily challenges, achievements.

## Server (Oracle Cloud)
- VM **DuckysSrv**, us-ashburn-1, IP **150.136.43.207** (ephemeral: reserving one changes the address; the user hasn't
  decided), Ubuntu, also runs their Minecraft servers. SSH: `ubuntu@150.136.43.207` with
  `C:\Users\tomer\OneDrive\Desktop\OracleServer\ssh-key-2026-10-21.key`. OCI CLI: `~/bin/oci` (pass `--region us-ashburn-1`).
- Service `cogwild` (127.0.0.1:8765) behind nginx + Let's Encrypt for `cogwild.duckdns.org`. Data: `/opt/cogwild/data/db.json`
  (daily copies in `data/backups`), downloads in `/opt/cogwild/downloads`. Optional settings in `/etc/cogwild.env`.
- Upkeep: cron `/etc/cron.d/cogwild` runs the watchdog every 2 min and the off-server backup nightly (bucket
  `cogwild-backups`, write-only link in `/etc/cogwild-backup.url`). Oracle alarm "DuckysSrv is down" emails the user.

### Deploy (website + server)
```bash
K="/c/Users/tomer/OneDrive/Desktop/OracleServer/ssh-key-2026-10-21.key"; PACK=/tmp/cogwild-upload.tgz
tar --force-local -czf "$PACK" index.html favicon.svg js fonts img server deploy privacy.html terms.html credits.html download.html manifest.webmanifest sw.js
scp -q -i "$K" "$PACK" ubuntu@150.136.43.207:/tmp/cogwild.tgz
ssh -i "$K" ubuntu@150.136.43.207 "sudo cp /opt/cogwild/data/db.json /opt/cogwild/data/backups/db-before-X.json; rm -rf ~/cogwild-src && mkdir -p ~/cogwild-src && tar -xzf /tmp/cogwild.tgz -C ~/cogwild-src && sed -i 's/\r$//' ~/cogwild-src/deploy/*.sh && sudo bash ~/cogwild-src/deploy/setup.sh cogwild.duckdns.org"
```
(`deploy\upload.ps1` does the same but stops early in PowerShell because nginx prints to stderr.)
Then: `node --experimental-websocket tests/live-smoke.js`.

### Apps
```powershell
& C:\Users\tomer\cogwild\build-apps.ps1 -Upload -Ip 150.136.43.207 -Key "C:\Users\tomer\OneDrive\Desktop\OracleServer\ssh-key-2026-10-21.key"
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
- CSP is strict (`script-src 'self'`): no inline scripts or `onclick=` in pages.
- Two Electron windows in one test: create both before destroying either (a fresh window after a destroyed one can fail to load).
- Class names on lobby buttons used to clash with other screens' styles (`.ach`, `.road`): keep side buttons as plain `side-btn`.
- The server's sign-up limit is 5 accounts per network per hour (tests reuse accounts for that reason).

## Waiting on the user
- Email sending: run `deploy\set-login.ps1` (Gmail app password or other SMTP; optional Google OAuth client ID).
  Steps are in `LAUNCH.md` > "Turn on email login".
- Decide whether to reserve the server IP (changes the address: update DuckDNS + tell Minecraft players).
- Optional cleanup of old downloads on the server (1.0–1.6.3).
- Confirm the Oracle alert email subscription.
- Store launch: Google Play closed test (12 testers × 14 days), itch.io/CrazyGames/Poki submissions (zips in `dist/`).
