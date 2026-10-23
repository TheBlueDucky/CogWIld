# Cogwild tests

All game tests run **muted**, in hidden (offscreen) Electron windows. Never test with sound, and never in a visible browser tab.

## Server self-test (start here)
```bash
node --experimental-websocket server/selftest.js
```
Starts its own throwaway server, a fake mail server and a fake Google key set, and runs ~117 checks:
accounts, cloud saves, friends, parties, matchmaking, economy/wallet, guests, email + Google login, clubs,
weekly events, Ranked, security, fair play (results checks, host migration, referee), spectating.

## Game tests (Electron, against a local server on port 8781)
Start a local server first (its own data folder, short searches):
```bash
PORT=8781 SEARCH_SECS=6 TROPHY_MIN_SECS=0 DATA_DIR=/tmp/cw-test node server/server.js
```
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
| `ui-shots.js` | screenshots of lobby, panels, Workshop, a match and results (`SIZES=1280x720,800x450`; run one size per process) |

## Live checks (against https://cogwild.duckdns.org, they clean up after themselves)
```bash
node --experimental-websocket tests/live-smoke.js     # sign up, cloud save, friends, party matchmaking, leaderboard
node --experimental-websocket tests/live-signup.js    # one-step sign up + log in with email
```
