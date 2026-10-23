# Cogwild launch checklist

The game, server, website, apps and store texts are ready. What's left below needs **your accounts, money or decisions**, so only you can do it.

> **If you're under 18:** stores and ad networks pay out money and need tax forms, so a parent or guardian should create and own the store accounts (Google Play, Steam, itch.io payouts, CrazyGames, Poki).

**What's ready**
| Where | File / link | How to rebuild |
|---|---|---|
| Website (play in browser, installable) | https://cogwild.duckdns.org | `deploy\upload.ps1` (see deploy/README.md) |
| Download page | https://cogwild.duckdns.org/download | `build-apps.ps1 -Upload ...` |
| Windows installer + portable | `dist\downloads\Cogwild-Setup-1.7.0.exe`, `Cogwild-1.7.0-portable.exe` | `build-apps.ps1` |
| Android (sideload) | `dist\downloads\Cogwild-1.7.0.apk` (release-signed) | `build-apps.ps1` |
| Google Play | `dist\store\Cogwild-1.7.0.aab` | `build-apps.ps1` |
| itch.io / CrazyGames / Poki | `dist\cogwild-itch.zip`, `cogwild-crazygames.zip`, `cogwild-poki.zip` | `build-itch.ps1 -Portal all` |
| Store texts, ratings, data safety | [STORE_PAGE.md](STORE_PAGE.md) | |
| Screenshots + share image | `dist\store\screenshots\`, `img\og-image.png` | `cd desktop; node copy-game.js; npx electron shots.js` |
| Privacy / Terms / Credits | `/privacy.html`, `/terms.html`, `/credits.html` | |

---

## 0. Before anything (important)
- [ ] **Back up the Android signing key**: copy the whole `android\keys` folder to a USB stick or a private cloud folder. Without it you can never update the Android app again. Don't share it or put it online.
- [ ] **Back up player accounts** now and then (see deploy/README.md §5). The server already keeps 14 daily copies.
- [ ] Check the name "Cogwild" in trademark databases ([USPTO](https://tmsearch.uspto.gov), [EUIPO](https://euipo.europa.eu/eSearch/)).
- [ ] Optional: a real domain (about $10/year, e.g. cogwild.gg). Then: point it at the server, `upload.ps1 -Domain`, run certbot for it, and replace `cogwild.duckdns.org` in `deploy\copy-app.js`, `build-itch.ps1`, the legal pages and STORE_PAGE.md.
- [ ] Optional: have the Privacy Policy and Terms read by someone who knows the law in your country.
- [ ] Play on 2-3 devices (a weak laptop, an Android phone), and watch 5 friends play **without helping them**.

## 1. itch.io (free, fastest)
- [ ] Create a project → Kind **HTML** → upload `dist\cogwild-itch.zip` → tick **"played in the browser"**, viewport **1280×720**, **fullscreen button** and **mobile friendly** (landscape).
- [ ] Also upload `Cogwild-Setup-1.7.0.exe` (Windows) and `Cogwild-1.7.0.apk` (Android) as downloads.
- [ ] Texts from STORE_PAGE.md, the 6 screenshots, cover image 630×500 (crop one screenshot).
- [ ] Price: $0 or "name your price".

## 2. Google Play (Android)
- [ ] Google Play Console account: **$25 once**. New personal accounts must run a **closed test with at least 12 testers for 14 days** before going public. Start that early!
- [ ] Create the app → upload `dist\store\Cogwild-1.7.0.aab` → turn on **Play App Signing** (default).
- [ ] Store listing: title, short and long description, icon `img\icon-512.png`, feature graphic **1024×500** (crop `img\og-image.png`), at least 2 phone screenshots (the 16:9 screenshots work).
- [ ] App content: privacy policy URL, **Data safety** and **content rating** answers (STORE_PAGE.md), target audience (choose 13+ or "all ages"; if you include under-13s, Google's Families policy applies), ads: **no**, account deletion URL `https://cogwild.duckdns.org/privacy.html#deleting`.
- [ ] For each update: raise `versionCode` (+1) and `versionName` in `android\android\app\build.gradle`.

## 3. Windows: Steam and Microsoft Store
- [ ] **Steam**: Steam Direct fee **$100**, tax/bank forms, store page early (wishlists take months), capsule images (use the screenshots + logo). Upload the `desktop\dist\win-unpacked` folder with SteamPipe.
- [ ] **Microsoft Store** (free for individuals): Partner Center account, then add `"appx"` to the `win.target` list in `desktop\package.json` with your Partner Center publisher ID, and upload the `.appx`.
- [ ] Optional: a **code-signing certificate** (~$100-300/year) removes the "Windows protected your PC" warning on the download page.

## 4. Web game portals (ad revenue share)
- [ ] **CrazyGames** (developer.crazygames.com): upload `dist\cogwild-crazygames.zip` (their SDK is already inside). Read their rules: they may ask you to use their own login. Guests can already play everything except trophies.
- [ ] **Poki** (developers.poki.com): apply, then upload `dist\cogwild-poki.zip`.
- [ ] Portal copies hide the "Get the app" link (portal rule) and still play online on your server.

## 5. iPhone / iPad
- [ ] Without a Mac and a $99/year Apple developer account there's no App Store version. iPhone players can already play on the website: Safari → Share → **Add to Home Screen** runs it fullscreen like an app.

## 6. Keep it running
- [ ] Free **UptimeRobot** monitor on `https://cogwild.duckdns.org/health`.
- [ ] Log in to duckdns.org once in a while; if the server IP ever changes, update it there.
- [ ] After game changes: `deploy\upload.ps1` (web) and `build-apps.ps1 -Upload` (apps; raise the version first).
- [ ] Watch `sudo journalctl -u cogwild -f` after big updates.

## 7. Getting players
- [ ] 3-5 short clips a week (F8 in game → TikTok / YouTube Shorts / Reels). Ideas: "I built a ___ in 75 seconds", spike-ram fails, plane crashes, Boss Battle wins, Trophy Road unlocks.
- [ ] A **Discord** with channels for blueprints (share codes!), bugs and weekly build challenges. Add its invite to the itch.io page.
- [ ] Post on r/WebGames, r/indiegames, r/IndieDev, r/playmygame.
- [ ] Send the link to small YouTubers/streamers (1k-50k subscribers) who play building or mech games.


## Turn on Google sign-in (v1.7+)

New players sign up with Google: the game opens their own browser, they pick their Google account, then come back
and choose a username. No password, no email code. Logging in later works the same way (one click if they're
still signed in to Google in that browser). Older accounts can still log in with email/username + password.
Until this is set up the game keeps working as before (guests + username/password).

1. Open https://console.cloud.google.com and sign in with the Google account that should own the game.
   Make a new project called **Cogwild**.
2. **Google Auth Platform → Branding** (older menus: *APIs & Services → OAuth consent screen*): app name **Cogwild**,
   support email theblueduckymc@gmail.com, home page `https://cogwild.duckdns.org`, privacy policy
   `https://cogwild.duckdns.org/privacy.html`, terms `https://cogwild.duckdns.org/terms.html`.
   **Audience: External**, then **Publish app** (it only asks for the email address, so Google doesn't need to review it).
3. **Clients → Create client → Web application**, name *Cogwild*. Under **Authorized redirect URIs** add exactly
   `https://cogwild.duckdns.org/auth/google/done` and press **Create**. Copy the **Client ID**
   (it ends in `.apps.googleusercontent.com`; it isn't secret).
4. Give the Client ID to Claude, or run:

       powershell -ExecutionPolicy Bypass -File deploy\set-google.ps1 -Ip 150.136.43.207 -Key C:\path\to\ssh-key.key -ClientId <the Client ID>

Email codes (forgotten passwords of older accounts) are optional: `deploy\set-login.ps1` turns them on (it asks for
an SMTP mail account; Gmail needs an *App password*). Game portals (itch.io, CrazyGames, Poki) never force a login.

## Voice chat relay (v1.7+)

Voice chat goes through a relay on the server (coturn), so players never see each other's internet address.
`deploy/setup-turn.sh` installs it (`sudo bash ~/cogwild-src/deploy/setup-turn.sh cogwild.duckdns.org`) and the Oracle
security list needs **UDP 3478, TCP 3478 and UDP 49160-49200** open (done on 23 Oct 2026 for DuckysSrv).

