# One safe release, in an order where players never see a broken download:
#   1. checks (server self-test, syntax of every script)
#   2. builds every app and uploads them (the download page still shows the old version: the new files just sit next to it)
#   3. builds the itch.io / CrazyGames / Poki zips
#   4. only then switches the website + game server to the new version (accounts backed up first)
#   5. live checks: the live smoke test and every download on the page answering with the right size
# Raise the version first:  node deploy\bump-version.js 1.9.0   (and add a What's new line in js\meta.js)
#   powershell -ExecutionPolicy Bypass -File release.ps1
#   ... -SkipApps        (website/server only, e.g. a server fix)
param([switch]$SkipApps, [string]$Ip = '84.13.68.152', [string]$Key = "$env:USERPROFILE\OneDrive\Desktop\OracleServer\ssh-key-2026-10-21.key")
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root
$ver = (Get-Content (Join-Path $root 'desktop\package.json') -Raw | ConvertFrom-Json).version
Write-Host "==> Releasing Cogwild $ver"

Write-Host '==> 1. Checks'
Get-ChildItem js, server, deploy -Filter *.js | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE) { throw "Syntax error in $($_.Name)" } }
node --experimental-websocket server/selftest.js | Select-Object -Last 1
if ($LASTEXITCODE) { throw 'Server self-test failed' }

if (-not $SkipApps) {
  Write-Host '==> 2. Apps (uploaded next to the old ones)'
  Get-ChildItem (Join-Path $root 'dist\downloads') -Filter 'Cogwild-*' -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch [regex]::Escape($ver) } | Remove-Item -Confirm:$false
  & (Join-Path $root 'build-apps.ps1') -Only windows, store, unix, android -Upload -Ip $Ip -Key $Key
  Write-Host '==> 3. Game-site zips'
  & (Join-Path $root 'build-itch.ps1') -Portal all
}

Write-Host '==> 4. Website + game server'
$pack = Join-Path $env:TEMP 'cogwild-upload.tgz'
# Git's GNU tar needs --force-local for C:\ paths; Windows' own tar.exe refuses that flag (and doesn't need it)
$tarFlags = @(); if ((tar --version 2>$null | Out-String) -match 'GNU') { $tarFlags = @('--force-local') }
tar @tarFlags -czf $pack index.html auth.html support.html favicon.svg js fonts img server deploy privacy.html terms.html credits.html download.html admin.html manifest.webmanifest sw.js
if ($LASTEXITCODE) { throw 'Packing the website failed' }
$ssh = @('-i', $Key, '-o', 'StrictHostKeyChecking=accept-new')
scp @ssh $pack "ubuntu@${Ip}:/tmp/cogwild.tgz"
if ($LASTEXITCODE) { throw 'Upload failed' }
# nginx -t prints to stderr even when all is fine: judge by the exit code only
$ErrorActionPreference = 'Continue'
ssh @ssh "ubuntu@$Ip" "sudo cp /opt/cogwild/data/db.json /opt/cogwild/data/backups/db-before-$ver.json; rm -rf ~/cogwild-src && mkdir -p ~/cogwild-src && tar -xzf /tmp/cogwild.tgz -C ~/cogwild-src && sed -i 's/\r$//' ~/cogwild-src/deploy/*.sh && sudo bash ~/cogwild-src/deploy/setup.sh cogwild.duckdns.org > /tmp/cogwild-setup.log 2>&1; tail -n 3 /tmp/cogwild-setup.log" 2>$null
$deployed = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($deployed) { throw 'Deploy failed (see /tmp/cogwild-setup.log on the server)' }

Write-Host '==> 5. Live checks'
$live = (Invoke-WebRequest -UseBasicParsing 'https://cogwild.duckdns.org/js/parts.js').Content
if ($live -notmatch [regex]::Escape("VERSION = 'v$ver'")) { throw "The live site isn't on v$ver" }
node --experimental-websocket tests/live-smoke.js | Select-Object -Last 1
if ($LASTEXITCODE) { throw 'Live smoke test failed' }
$page = (Invoke-WebRequest -UseBasicParsing 'https://cogwild.duckdns.org/download').Content
$bad = 0
foreach ($f in ([regex]::Matches($page, 'downloads/(Cogwild[^"]+)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)) {
  $local = Join-Path $root "dist\downloads\$f"
  $head = Invoke-WebRequest -UseBasicParsing -Method Head "https://cogwild.duckdns.org/downloads/$f"
  $ok = (Test-Path $local) -and ([int64]$head.Headers['Content-Length'] -eq (Get-Item $local).Length)
  '{0,-36} {1}' -f $f, $(if ($ok) { 'OK' } else { 'MISSING OR DIFFERENT' })
  if (-not $ok) { $bad++ }
}
if ($bad) { throw "$bad download(s) on the page don't match" }
Write-Host "Cogwild $ver is live. Microsoft Store: upload dist\store\Cogwild-$ver-store.appx in a new submission."
