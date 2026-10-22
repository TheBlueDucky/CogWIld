# Builds the Windows (.exe) and Android (.apk) apps into dist\downloads, and the Google Play bundle into dist\store.
#   powershell -ExecutionPolicy Bypass -File build-apps.ps1
#   ... -Upload -Ip 150.136.43.207 -Key C:\path\to\ssh-key.key   (also puts them on the server's download page)
# Before a new release, raise the version in desktop\package.json, android\android\app\build.gradle
# (versionCode + versionName) and the file names in download.html.
param([switch]$Upload, [string]$Ip = '', [string]$Key = '', [string]$User = 'ubuntu')
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'android\keys\release.properties'))) { throw 'android\keys\release.properties is missing: the Android release key (see LAUNCH.md)' }
$out = Join-Path $root 'dist\downloads'
New-Item -ItemType Directory -Force $out | Out-Null
$ver = (Get-Content (Join-Path $root 'desktop\package.json') -Raw | ConvertFrom-Json).version

Write-Host "==> Windows app $ver"
Push-Location (Join-Path $root 'desktop')
if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund; if ($LASTEXITCODE) { throw 'npm install failed' } }
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npm run build
if ($LASTEXITCODE) { throw 'Windows build failed' }
Copy-Item "dist\Cogwild-Setup-$ver.exe", "dist\Cogwild-$ver-portable.exe" $out -Force
Pop-Location

Write-Host "==> Android app $ver"
Push-Location (Join-Path $root 'android')
if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund; if ($LASTEXITCODE) { throw 'npm install failed' } }
npm run sync
if ($LASTEXITCODE) { throw 'Android sync failed' }
Push-Location android
# signed with android\keys (release.properties): the .aab is what Google Play wants, the .apk is for the download page
.\gradlew.bat assembleRelease bundleRelease --console=plain
if ($LASTEXITCODE) { throw 'Android build failed' }
Copy-Item 'app\build\outputs\apk\release\app-release.apk' (Join-Path $out "Cogwild-$ver.apk") -Force
$store = Join-Path $root 'dist\store'
New-Item -ItemType Directory -Force $store | Out-Null
Copy-Item 'app\build\outputs\bundle\release\app-release.aab' (Join-Path $store "Cogwild-$ver.aab") -Force
Pop-Location; Pop-Location

Get-ChildItem $out | ForEach-Object { '{0,-36} {1,6:N1} MB' -f $_.Name, ($_.Length / 1MB) }

if ($Upload) {
  if (-not $Ip -or -not $Key) { throw 'Upload needs -Ip and -Key' }
  Write-Host "==> Uploading to $User@$Ip"
  $sshOpts = @('-i', $Key, '-o', 'StrictHostKeyChecking=accept-new')
  scp @sshOpts (Get-ChildItem $out).FullName "${User}@${Ip}:/tmp/"
  if ($LASTEXITCODE) { throw 'Upload failed' }
  $names = (Get-ChildItem $out).Name -join ' '
  ssh @sshOpts "$User@$Ip" "cd /tmp && sudo mkdir -p /opt/cogwild/downloads && sudo mv $names /opt/cogwild/downloads/ && sudo chown -R cogwild:cogwild /opt/cogwild/downloads && ls -la /opt/cogwild/downloads"
  if ($LASTEXITCODE) { throw 'Moving the files into place failed' }
}
Write-Host 'Done!'
