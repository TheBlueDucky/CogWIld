# Builds dist/cogwild-web.zip for itch.io and web portals.
# Usage:  powershell -ExecutionPolicy Bypass -File build-itch.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$stage = Join-Path $root 'dist\web'
$zip = Join-Path $root 'dist\cogwild-web.zip'

if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null

# only the files the game needs (no dev server, docs or desktop wrapper)
Copy-Item (Join-Path $root 'index.html') $stage
Copy-Item (Join-Path $root 'privacy.html') $stage
Copy-Item -Recurse (Join-Path $root 'js') (Join-Path $stage 'js')

if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
$sizeMb = [math]::Round((Get-Item $zip).Length / 1MB, 2)
Write-Host "Built $zip ($sizeMb MB). Upload it to itch.io as an HTML game."
if (-not (Test-Path (Join-Path $root 'js\vendor\three.min.js'))) {
  Write-Host "Note: js/vendor/three.min.js is missing, so the game will load three.js from the CDN (see LAUNCH.md)."
}
