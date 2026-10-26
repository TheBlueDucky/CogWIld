# Turns on the moderation page (https://cogwild.duckdns.org/admin): makes a new secret moderator key on this PC,
# puts it on the server (/etc/cogwild.env, ADMIN_TOKEN), restarts the game server, copies the key to your clipboard,
# keeps a copy next to your SSH key and opens the page. Paste the key there. Run it again any time for a new key
# (the old one stops working).
#
#   powershell -ExecutionPolicy Bypass -File deploy\set-admin.ps1
param(
  [string]$Ip = '84.13.68.152',
  [string]$Key = "$env:USERPROFILE\OneDrive\Desktop\OracleServer\ssh-key-2026-10-21.key",
  [string]$User = 'ubuntu'
)
$ErrorActionPreference = 'Stop'
# 32 random bytes from Windows' secure random generator -> 64 hex characters
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$token = -join ($bytes | ForEach-Object { $_.ToString('x2') })
$sshOpts = @('-i', $Key, '-o', 'StrictHostKeyChecking=accept-new')
# the key goes through the SSH connection's input (never on a command line)
$cmd = "read -r T && sudo touch /etc/cogwild.env && sudo sed -i '/^ADMIN_TOKEN=/d' /etc/cogwild.env && echo `"ADMIN_TOKEN=`$T`" | sudo tee -a /etc/cogwild.env >/dev/null && sudo chmod 600 /etc/cogwild.env && sudo systemctl restart cogwild && sleep 2 && curl -fsS http://127.0.0.1:8765/health"
$token | ssh @sshOpts "$User@$Ip" $cmd
if ($LASTEXITCODE -ne 0) { throw 'Could not update the server' }
$copy = Join-Path (Split-Path $Key) 'cogwild-moderator-key.txt'
Set-Content -Path $copy -Value $token -Encoding ascii
Set-Clipboard -Value $token
Write-Host ''
Write-Host 'Done. The moderator key is in your clipboard (a copy is in' $copy ').'
Write-Host 'Paste it on the page that opens now, tick "remember", and press Open.'
Start-Process 'https://cogwild.duckdns.org/admin'
