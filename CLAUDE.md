# Cogwild — project guide (read this first)

Cogwild is a 3D mech-building battle game by **BlueDucky Games** (public contact: theblueduckymc@gmail.com).
You build a mech from parts in the Workshop, then fight online (bots fill empty seats) on land, water and sky.
It runs in the browser (three.js r128, no build step), as a Windows app (Electron) and an Android app (Capacitor),
and on game portals (itch.io, CrazyGames, Poki). The online server is zero-dependency Node.js.

**Live:** https://cogwild.duckdns.org (download page `/download`) · **Current version:** v1.7.5 · **Online protocol:** `cogwild-net-9`
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
| `js/account.js` | login/sign-up box (Google in the player's browser: `startGoogle`), wallet (server coins), Cog Pass panel, clubs, friends, party, Trophy Road, leaderboard |
| `js/talk.js` | the chat window (💬 / Enter): Match (quick chat only), Party, Club, Friends (private messages); tap a name: profile / block / report |
| `js/voice.js` | voice chat (WebRTC audio, through the server's TURN relay): only joined in a party (or a room when hearing "my match"), mic opened only while unmuted/undeafened; push-to-talk B, mute M, deafen N (any can be "No key"), devices, the first-time "Use voice chat?" question |
| `js/pics.js` | picking your own / your club's picture: square cropper (shown as a circle), sends a 256×256 JPEG |
| `js/meta.js` | shop, challenges, settings, panels, the PLAY panel (modes/arenas/weekly/ranked/gadgets), What's new |
| `js/supers.js`, `js/gadgets.js` | supers (X) and gadgets (G, 3 uses) |
| `js/touch.js` | phone controls (right-thumb arc, up/down by the stick, Exit needs a hold) |
| `server/server.js` | HTTP + WebSocket server, rooms, matchmaking (`quick`, kinds weekly/ranked), result checks, mech checks, spectating, security headers/CSP |
| `server/filter.js` | chat filter: bad words (English + Hebrew, also disguised) -> ****, links/emails/phone numbers/social handles -> [hidden]; used for typed chat and club descriptions, refuses usernames and club names |
| `server/pics.js` | own profile + club pictures: square JPEGs ≤64 KB in DATA_DIR/pics, served at `/pic/u/<name>.jpg`, `/pic/c/<id>.jpg` (`pv` = version) |
| `server/talk.js` | typed chat (DMs in `db.dms`, club chat in `db.clubChat`, both deleted after 7 days; party lines in memory; DMs between friends or club-mates), Quick chat only (`u.cm`), block (`u.blocked`), reports (`db.reports`), voice peers + signaling, TURN logins |
| `auth.html`, `js/auth-done.js` | the page Google sends players back to (`/auth/google/done`); posts the token to `/auth/google/finish` |
| `server/accounts.js` | accounts + JSON DB (`db.users`, `db.guests`, `db.clubs`), wallet (coins/XP/unlocks/pass), email/Google login, friends, parties, clubs, trophies, Ranked |
| `server/referee.js` | checks every match message: hits only from whoever controls the shooter, damage capped by the mech's weapons, speed and "ignores damage" notes |
| `server/mailer.js`, `server/google.js` | SMTP login codes; Google ID token checks |
| `server/selftest.js` | ~142 server checks (fake SMTP + fake Google keys), incl. chat, voice set-up and browser Google sign-in |
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
- **Chat/voice:** matches = quick chat only (keys 1-8); friends/party/club = free text (200 chars, no word filter yet) or
  quick lines (`TALK_QUICK` in economy.js). "Quick chat only" (kids) is per account and also turns voice off. Voice needs an
  account; peers = same party, or same room when both chose "my match"; always via the TURN relay (no IPs shared). Free
  chat is off on CrazyGames/Poki and voice is off on every portal (their frames block the mic). The game asks "Use voice chat?" on first start, after each update and per account.
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
tar --force-local -czf "$PACK" index.html auth.html favicon.svg js fonts img server deploy privacy.html terms.html credits.html download.html manifest.webmanifest sw.js
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
- Never zip with `Compress-Archive` (Windows PowerShell 5.1): it stores `js\economy.js` with backslashes, and Linux hosts (itch.io,
  portals) unpack that as one odd file name, so the game sticks on "Building the arena…". build-itch.ps1 uses .NET ZipFile with `/`.
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
- Possibly a chat word filter later (they asked to wait).
- Microsoft Store: reserve the name in Partner Center (free individual account) and give Product identity Name + Publisher, then rebuild the .appx (LAUNCH.md §3).
- The Mac builds were never tried on a real Mac (built on Windows); Linux arm64 was smoke-tested in Docker on DuckysSrv.
- Optional: delete the empty "CogWild" Google Cloud project on the personal Google account (made by mistake, no billing).

## Google sign-in (done 23 Oct 2026)
Google Cloud project **cogwild-512516** owned by theblueduckymc@gmail.com (no billing account: free), Google Auth Platform
External + **In production**, support email theblueduckymc@gmail.com, scopes openid + email only (no review needed),
web client "Cogwild game", redirect URI `https://cogwild.duckdns.org/auth/google/done`, Client ID
`763067835148-fvqhbbrbv5ugnb7160aqajm7vhaacgdr.apps.googleusercontent.com` (public, set with `deploy\set-google.ps1`).
The client secret is not used (implicit id_token flow) and was not saved. The built-in browser has both Google accounts
signed in, which makes Cloud Console pages fail to load now and then: Retry, or go through `/apis/credentials/consent`.
