# Builds a web-portal copy of the game: dist\cogwild-<portal>.zip
#   powershell -ExecutionPolicy Bypass -File build-itch.ps1                       (itch.io)
#   powershell -ExecutionPolicy Bypass -File build-itch.ps1 -Portal crazygames    (adds the CrazyGames SDK)
#   powershell -ExecutionPolicy Bypass -File build-itch.ps1 -Portal poki          (adds the Poki SDK)
#   ... -Portal all                                                               (all three zips)
# The copy plays online on the live server (change it with -ServerUrl wss://your-domain/ws).
param([ValidateSet('itch', 'crazygames', 'poki', 'all')][string]$Portal = 'itch', [string]$ServerUrl = 'wss://cogwild.duckdns.org/ws')
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$sdks = @{
  'crazygames' = '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>'
  'poki'       = '<script src="https://game-cdn.poki.com/scripts/v2/poki-sdk.js"></script>'
}
$site = $ServerUrl -replace '^ws', 'http' -replace '/ws$', '/'
$utf8 = New-Object Text.UTF8Encoding $false

foreach ($p in $(if ($Portal -eq 'all') { 'itch', 'crazygames', 'poki' } else { $Portal })) {
  $stage = Join-Path $root "dist\web-$p"
  $zip = Join-Path $root "dist\cogwild-$p.zip"
  if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
  New-Item -ItemType Directory -Force $stage | Out-Null

  # only the files the game needs (no server, docs or app wrappers)
  foreach ($f in 'index.html', 'privacy.html', 'terms.html', 'credits.html', 'favicon.svg') { Copy-Item (Join-Path $root $f) $stage }
  foreach ($d in 'js', 'fonts', 'img') { Copy-Item -Recurse (Join-Path $root $d) (Join-Path $stage $d) }

  # online server + which portal this copy is for (the game hides app/install links on portals)
  $cfg = Join-Path $stage 'js\config.js'
  $text = [IO.File]::ReadAllText($cfg, [Text.Encoding]::UTF8)
  $text = $text.Replace("CW.SERVER_URL = '';", "CW.SERVER_URL = '$ServerUrl';").Replace("CW.PUBLIC_URL = '';", "CW.PUBLIC_URL = '$site';").Replace('})();', "  CW.PORTAL = '$p';`n})();")
  [IO.File]::WriteAllText($cfg, $text, $utf8)

  # the portal's SDK goes right before platform.js, which detects it
  if ($sdks.ContainsKey($p)) {
    $index = Join-Path $stage 'index.html'
    $html = [IO.File]::ReadAllText($index, [Text.Encoding]::UTF8)
    $html = $html -replace '(<script src="js/platform\.js[^"]*"></script>)', ($sdks[$p] + "`n" + '$1')
    [IO.File]::WriteAllText($index, $html, $utf8)
  }

  if (Test-Path $zip) { Remove-Item -Force $zip }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
  '{0,-28} {1,5:N1} MB  (server {2})' -f "dist\cogwild-$p.zip", ((Get-Item $zip).Length / 1MB), $ServerUrl
}

# itch.io: one folder with everything to upload (the browser version and the downloads, if build-apps.ps1 made them)
if ($Portal -eq 'all' -or $Portal -eq 'itch') {
  $itch = Join-Path $root 'dist\itch'
  if (Test-Path $itch) { Remove-Item -Recurse -Force $itch }
  New-Item -ItemType Directory -Force $itch | Out-Null
  Copy-Item (Join-Path $root 'dist\cogwild-itch.zip') (Join-Path $itch 'cogwild-web.zip')
  $dl = Join-Path $root 'dist\downloads'
  $ver = (Get-Content (Join-Path $root 'desktop\package.json') -Raw | ConvertFrom-Json).version
  $files = @(
    @("Cogwild-$ver-portable.exe", 'Windows'), @("Cogwild-$ver-linux-x64.tar.gz", 'Linux'), @("Cogwild-$ver-linux-arm64.tar.gz", 'Linux (ARM)'),
    @("Cogwild-$ver-mac-arm64.zip", 'macOS (Apple Silicon)'), @("Cogwild-$ver-mac-x64.zip", 'macOS (Intel)'))
  $lines = @("Cogwild $ver for itch.io: upload each file on the game's Edit page > Uploads and tick its platform.", '', 'cogwild-web.zip  -> "This file will be played in the browser" (viewport 1280 x 720, Fullscreen button on)')
  foreach ($f in $files) {
    $src = Join-Path $dl $f[0]
    if (Test-Path $src) { Copy-Item $src $itch; $lines += ('{0}  -> {1}' -f $f[0], $f[1]) }
  }
  [IO.File]::WriteAllLines((Join-Path $itch 'UPLOAD-THESE.txt'), $lines, $utf8)
  Write-Host ('itch.io folder: {0}' -f $itch)
  Get-ChildItem $itch | ForEach-Object { '  {0,-36} {1,6:N1} MB' -f $_.Name, ($_.Length / 1MB) }
}

