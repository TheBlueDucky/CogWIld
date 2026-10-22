# Putting Cogwild online (Oracle Cloud)

One small VM runs everything: the game page, the online server and HTTPS. The Oracle **Always Free** VM (Ampere A1 ARM or the AMD micro) is plenty for a start: one server easily handles hundreds of players, because every player's computer runs its own game and the host player's computer runs the bots.

## 1. Open the ports in the Oracle console (one time)
The VM is behind Oracle's cloud firewall, which only lets SSH in by default.

1. Oracle Cloud console → **Networking → Virtual cloud networks** → your VCN.
2. **Security Lists** → **Default Security List for …** → **Add Ingress Rules**.
3. Add a rule: Source CIDR `0.0.0.0/0`, IP Protocol **TCP**, Destination Port Range **80**.
4. Add another rule with Destination Port Range **443**.

(The setup script opens the same ports on the VM's own firewall.)

## 2. Upload and install (from your Windows PC)
You need the VM's **public IP** (instance details page) and the **private SSH key** you downloaded when you created it.

```powershell
cd C:\Users\tomer\cogwild
powershell -ExecutionPolicy Bypass -File deploy\upload.ps1 -Ip YOUR.VM.IP -Key C:\path\to\your-ssh-key.key
```

- Oracle Linux image: add `-User opc` (Ubuntu images use the default `ubuntu`).
- Have a domain? Point its **A record** at the VM IP, then add `-Domain play.yourgame.com`.
  Without one, the game gets a free address like `https://129-146-1-2.sslip.io`.

The first install takes a few minutes. At the end it prints your game's address. Open it, press **🌐 Online**, and you're live.

## 3. Updating
Run the same `upload.ps1` command again after you change the game. Players get the new version on their next page load.
(Matches running at that moment end; they can rejoin right away.)

## 4. Checking on it
| What | Command (on the VM via SSH) |
|---|---|
| Is it up? | open `https://YOUR-ADDRESS/health` in a browser: shows rooms and players online |
| Live log | `sudo journalctl -u cogwild -f` |
| Restart | `sudo systemctl restart cogwild` |
| HTTPS log | `sudo journalctl -u caddy -n 50` |

Tip: a free [UptimeRobot](https://uptimerobot.com) monitor on `/health` emails you if the server goes down.

## 5. Accounts, trophies and backups
Player accounts (username + password, cloud saves, friends, trophies) are stored on the VM in `/opt/cogwild/data/db.json`.
- **Backups**: the server keeps one copy per day in `/opt/cogwild/data/backups/` (last 14 days). For an off-server copy:
  ```powershell
  scp -i C:\path\to\ssh-key.key ubuntu@YOUR.VM.IP:/opt/cogwild/data/db.json .\cogwild-db-backup.json
  ```
- **Restore**: `sudo systemctl stop cogwild`, copy a backup over `db.json`, `sudo systemctl start cogwild`.
- Updating the game (`upload.ps1`) never touches `data/`.
- Passwords are stored as scrypt hashes, never as plain text. There is no email, so a forgotten password can't be reset by players: you can delete an account by removing it from `db.json` (with the server stopped).
- Test the whole account system locally any time: `node --experimental-websocket server/selftest.js`

## 6. The Windows and Android apps
`build-apps.ps1` builds `Cogwild-Setup-<version>.exe`, `Cogwild-<version>-portable.exe` and `Cogwild-<version>.apk` into `dist\downloads`, and with `-Upload` puts them on the server's download page (`https://YOUR-ADDRESS/download`):
```powershell
powershell -ExecutionPolicy Bypass -File build-apps.ps1 -Upload -Ip YOUR.VM.IP -Key C:\path\to\ssh-key.key
```
- The apps contain the game files and talk to `wss://cogwild.duckdns.org/ws` (set `COGWILD_SERVER` to build for another server).
- Web updates reach app players only when they install a new app version, so after big changes run `build-apps.ps1` again. For a new version, raise it in `desktop\package.json`, `android\android\app\build.gradle` (`versionCode` + `versionName`) and the file names in `download.html`.
- The `.exe` is not code-signed (Windows shows "More info → Run anyway"), and the `.apk` is debug-signed (fine for sideloading; Google Play needs a release key).
- Needs Node.js, Java (17+) and the Android SDK (`%LOCALAPPDATA%\Android\Sdk`), all already on this PC.

## 7. Game copies on itch.io / CrazyGames / Poki
Those sites host the game files themselves, so tell that copy where your server is:

```powershell
powershell -ExecutionPolicy Bypass -File build-itch.ps1 -ServerUrl wss://YOUR-ADDRESS/ws
```

## How online play works (short)
- **PLAY = matchmaking** per arena (or any arena): up to 8 players; when the search has run 30 s, bots fill the empty seats and the match starts (a full room starts at once). Plus public rooms and private rooms with a 5-letter code / invite link.
- The room's **host** (first player) runs the bots, scores, pickups, chests and the end of the match. Every player drives their own mech, and the shooter's game decides what its shots hit.
- If a player leaves, a bot takes over their mech. If the host leaves, the match ends and someone else becomes host.
- **Quick chat only** (keys 1–8 in a match, buttons in the room): no free text, which keeps it safe for younger players.
- The server has message size and rate limits, cleans up names and only serves the game files.
- Progress (levels, coins, unlocks) is saved on each player's device and, when they're logged in, backed up to their account (the newest copy wins when they log in somewhere else).
- Matchmaking (PLAY) moves trophies (host-reported placings, matches shorter than 40 s don't count). Parties of up to 4 friends follow their leader into rooms.
- The search time is 30 s (`SEARCH_SECS` in the service to change it).
