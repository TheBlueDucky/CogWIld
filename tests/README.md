# Cogwild tests

All game tests run **muted**, in hidden (offscreen) Electron windows. Never test with sound, and never in a visible browser tab.

## Server self-test (start here)
```bash
node --experimental-websocket server/selftest.js
```
Starts its own throwaway server, a fake mail server and a fake Google key set, and runs ~142 checks:
accounts, cloud saves, friends, parties, matchmaking, economy/wallet, guests, email + Google login, clubs,
weekly events, Ranked, security, fair play (results checks, host migration, referee), spectating.

## Game tests (Electron, against a local server on port 8781)
Start a local server first (its own data folder, short searches, more sign-ups per hour than the live server):
```bash
PORT=8781 SEARCH_SECS=6 TROPHY_MIN_SECS=0 SIGNUPS_PER_HOUR=100 DATA_DIR=/tmp/cw-test node server/server.js
```
`talk-test.js` also needs one with Google sign-in on (fake client ID, only for the login box):
```bash
PORT=8782 SIGNUPS_PER_HOUR=100 DATA_DIR=/tmp/cw-test2 GOOGLE_CLIENT_ID=test-client node server/server.js
```
Tests that aren't about voice chat answer the "Use voice chat?" question with "Keep it off" (`tests/no-voice-ask.js`).
Add `MAIL_DEV=1` to test the email-code steps (codes are printed and filled in for you).
Then run one with `desktop/node_modules/.bin/electron tests/<file>.js` (screenshots go to `tests/shots/`):

| File | What it checks |
|---|---|
| `soak-test.js` | every mode on every arena, sped up, player driving/shooting/using super + gadget; console errors, crashes, blocked resources (`MODES=clash` to limit, `WEEKLY=1` for event modifiers) |
| `online-test.js` | two clients log in, PLAY together, chat, finish, get trophies (`EVENT=weekly`) |
| `host-migrate-test.js` | the host quits mid-match, the other client takes over (`MODE=koth|gold|clash|race|survival`) |
| `party-test.js` | friends, party, friend's mech on the lobby stage, searching together (`W=915 H=412 TOUCH=on` for phone size) |
| `spec-test.js` | watching a friend's match, the friend is told, Esc leaves |
| `signup-test.js` | sign up (email, password twice, username), log out, log in, same email refused |
| `login-test.js` | the email-code sign-up flow (needs `MAIL_DEV=1`) |
| `phone-test.js` | lobby, settings and match HUD at phone size with touch controls (`W=780 H=350`) |
| `wall-aim-test.js` | a mech hopping into a cliff stays below it, camera stays out of the cliff, touch aim assist turns toward enemies |
| `chat-test.js` | a quick-chat line shows once for the sender and once for the other player |
| `hover-test.js` | pointing at a settings row turns its text blue, no outline box |
| `menu-shots.js` | Shop (whole-card hover outline, "Buy it?" pop-up, Esc, a real purchase, no hover text), Cog Pass (also claimable tiers) and every Settings category (`SIZES=1280x720,915x412,780x350`) |
| `talk-test.js` | two players: friends, party chat, private message (also from the Friends list), T opens the chat, chat drag, party card chat, phone full-screen chat and in-match 💬, chat/voice while waiting for a match, voice from the player's position in an online match, voice chat connecting (fake microphone, muted), mute/deafen release the mic, push-to-talk, "No key", own picture (cropper, circle in the Friends list), Cog Pass drag + "how to tier up" links, Quick chat only, block menu, achievements progress, Settings > Keys hover, no text selection, phone tap outside a menu, phone upright typing, leaving the party releases the mic, the Google login box |
| `drive-test.js` | v1.8 driving + looks: aim stays put after A/D, front wheels steer, S brakes, new mechs in the Workshop (Body category, flat buttons), tracers, no flash at your own lens, wreck falls apart then explodes, Monster Truck on its big wheels, menu/countdown animations |
| `tags-test.js` | at 1920x1080: name tags sit on their mech at 20/60/120 m, every part in the Workshop list has a small picture |
| `fixes-test.js` | v1.8.2: T opens/closes chat in a match, getting out next to a cliff, pilots can't climb cliffs or pop onto bridge decks, a 63-part mech repairs in ~4 s, the fly hint and C flying down, heavy mechs, Ranked at 100, Gold finish on your mech, every wreck effect, sprite particles, Shop sections, Settings › Support |
| `tutorial-test.js` | the tutorial: small see-through card, keys lighting up, the arrow at the Target / gem / your mech, on phones the arrow + ring at the button to press |
| `ui-shots.js` | screenshots of lobby, panels, Workshop, a match and results (`SIZES=1280x720,800x450`; run one size per process) |

## Live checks (against https://cogwild.duckdns.org, they clean up after themselves)
```bash
node --experimental-websocket tests/live-smoke.js     # sign up, cloud save, friends, party matchmaking, leaderboard
node --experimental-websocket tests/live-signup.js    # one-step sign up + log in with email
```
And `desktop/node_modules/.bin/electron tests/live-voice.js`: two hidden, muted players chat and connect voice through the live relay (fake microphone), then delete their accounts.
