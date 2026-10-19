# Cogwild launch checklist

Everything in the game itself is ready for a first web launch. These are the steps **you** need to do, because they need your accounts, money or decisions.

> **If you're under 18:** stores and ad networks pay out money, so they need an adult. A parent or guardian should create and own the itch.io / CrazyGames / Poki / Steam accounts and fill in the tax forms.

---

## 1. Before anything goes public
- [ ] **Check the name "Cogwild"** in trademark databases: [USPTO](https://tmsearch.uspto.gov) and [EUIPO](https://euipo.europa.eu/eSearch/). Only general web searches have been done so far.
- [ ] Grab the social handles (TikTok, YouTube, Instagram, X, Discord server) and ideally a domain.
- [ ] Fill in `[DATE]` and `[YOUR CONTACT EMAIL]` in `privacy.html`. Use a separate email for the game, not a personal one.
- [ ] Play the whole game yourself on 2–3 different computers (one weak laptop). Then watch 5 friends play **without helping them** and note where they get stuck.
- [ ] Optional but recommended: put a local copy of three.js in `js/vendor/three.min.js` so the game doesn't depend on a CDN:
  ```bash
  curl -L -o js/vendor/three.min.js https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js
  ```

## 2. itch.io (free, fastest, good for feedback)
- [ ] Run `powershell -ExecutionPolicy Bypass -File build-itch.ps1`. This creates `dist/cogwild-web.zip`.
- [ ] On itch.io: **Create new project** → Kind: **HTML** → upload the zip → tick **"This file will be played in the browser"** → viewport **1280 × 720**, enable **Fullscreen button**.
- [ ] Paste the texts from `STORE_PAGE.md`, add 5+ screenshots and a GIF/clip (use F8 in game).
- [ ] Set price to **$0 or "name your price"** for now. Feedback matters more than money at this stage.

## 3. Web game portals (ad revenue share)
Both portals review games before accepting them.
- [ ] **CrazyGames**: developer portal at developer.crazygames.com. Add their SDK script **before** `js/platform.js` in `index.html`:
  ```html
  <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
  ```
  `js/platform.js` detects it automatically: gameplay start/stop events, ad breaks between matches and the "watch an ad to double coins" button all switch on.
- [ ] **Poki**: apply at developers.poki.com. Add their SDK the same way:
  ```html
  <script src="https://game-cdn.poki.com/scripts/v2/poki-sdk.js"></script>
  ```
- [ ] Use a separate zip per portal (each with only its own SDK line).
- [ ] Read each portal's rules (file size, no external links, loading time) before submitting.

## 4. Steam (after multiplayer, or as a single-player Early Access)
- [ ] Pay the **Steam Direct** fee ($100) and complete Steamworks tax/bank info.
- [ ] Make the **store page early**: wishlists take months to build.
- [ ] Build the desktop version (needs Node.js, already installed):
  ```bash
  cd desktop
  npm install
  npm run build
  ```
  This copies the game into `desktop/app`, wraps it with Electron and creates an installer in `desktop/dist`.
- [ ] Join a **Steam Next Fest** with a free demo.
- [ ] Add Steam features later (achievements and cloud saves map nicely onto the existing ones).

## 5. Online multiplayer (the big next project)
Not done yet, needs a server you host and pay for. Suggested stack: **Node.js + Colyseus** (authoritative server running the same physics), bots filling empty slots, private rooms with codes, quick-chat only. Budget about $5–50/month hosting to start.

## 6. Getting players (start now)
- [ ] Post 3–5 short clips a week (F8 in game → TikTok / YouTube Shorts / Reels). Ideas: "I built a ___ in 75 seconds", spike-ram fails, plane crashes, Omni mechs, Frost Isles at night.
- [ ] Make a **Discord** with channels for blueprints (share codes!), bugs and weekly build challenges.
- [ ] Post on r/WebGames, r/indiegames, r/IndieDev, r/playmygame when the itch.io page is up.
- [ ] Send the link to small YouTubers/streamers (1k–50k subscribers) who play building or mech games.
- [ ] Use the built-in **Back up save / Restore** for testers and the error **Copy report** button for bug reports.

## 7. Money, fairly
- Web: portal ad share + optional rewarded ads (already wired in).
- Steam: Early Access price around $7–12, or free-to-play with cosmetics.
- Later: real-money cosmetics (paints, trails, pedestals) and a cosmetic season pass.
- **Never** sell power (pay-to-win) and **no loot boxes**: they're restricted in several countries and players hate them.
