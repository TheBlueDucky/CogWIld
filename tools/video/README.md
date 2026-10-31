# Video tools (YouTube videos of Cogwild)

Everything runs in hidden, muted Electron windows against the local test server (port 8781): nothing is ever heard
or shown on screen while recording. Needs ffmpeg (`winget install Gyan.FFmpeg`). Output goes to `dist/youtube/`
(not in git).

How it works:
- **Frame-exact recording** (`cap.js` + `vt-page.js`): the page runs on a virtual clock. The recorder steps it exactly
  1/60 s, waits for the hidden window to draw that frame (a colour marker in the corner says which frame it is) and
  sends it to ffmpeg. However slow a frame is to draw, the video is a perfect 60 fps. The game's sounds go into an
  OfflineAudioContext on the same clock (never played out loud), saved as a WAV next to the video.
- **Replayable matches**: `__vt.seed(n)` fixes the game's dice and the clock starts at a fixed time, so a seed always
  plays the same match. A match is first played quickly without drawing it (`match.js`), then the same seed is played
  again and only the best moments are recorded.
- **The showcase pilot** (`pilot-page.js`) plays your mech through the normal controls (keys, mouse view, mouse
  button): human-like mouse aim (a quick flick with a little overshoot, then smooth tracking), strafing runs, dodges
  (dash / hop), jump pads and Jump Jets with mid-air flips, its super at a good moment. It steers clear of water and
  cliffs. Mech Ball has its own brain (attack the ball's back side, dash and flip shots).
- **Set-up** (`setup-page.js`): your mech + loadout for the video, bots that dodge and jump like hard bots but hit
  like normal ones (a bit weaker: the pilot should win), no seasonal decorations, no sandstorm/blackout, a clean HUD.
  Mech Ball: dash/flip shots that go roughly at the goal become real shots (like aim assist), never an own goal.

Making a video:
1. `npx electron match.js clash 202 canyon day` — plays seed 202 quickly; writes `dist/youtube/raw/sim-clash-202-canyon.json`
   (won? wrecks, flips, every event with its frame). `./batch.sh clash canyon day 201 202 203` tries several.
2. `node plan.js segs dist/youtube/raw/sim-clash-202-canyon.json` — the best moments as frame ranges.
3. `npx electron match.js clash 202 canyon day --rec clashA --segs <ranges>` — records them (`raw/clashA-1.mp4/.wav`, …).
4. `npx electron rec-intro.js intro-clash "Workshop Clash"` — the logo intro (`intro.html`).
5. `node plan.js edit "Cogwild - Workshop Clash" intro-clash clashA clashB` then `node edit.js dist/youtube/<name>.plan.json`
   — joins everything with short transitions, evens out the sound to YouTube's loudness (-14 LUFS), 1080p60 H.264.

The menu tour: `npx electron menu-video.js` (a mouse pointer with real hover/click events; `--preview` = stills only).
It logs into a test account on the local test server only.

The vertical short (TikTok / Reels / Shorts): record the moments in vertical with
`VW=1080 VH=1920 CLEANHUD=1 NOMUSIC=1 npx electron match.js <kind> <seed> <arena> <tod> --rec vA --segs ...`
(1080x1920, no small pop-ups, no game music: a song goes on top), then `npx electron short.js` — the 1-second logo hook
and the "DOWNLOAD NOW" text come from `short.html`, the cuts are listed in `short.js` (CUTS). Output `dist/youtube/Cogwild - Short.mp4`.
