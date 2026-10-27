# Builds the apps into dist\downloads (the download page): Windows (.exe), Linux (.tar.gz, x64 + arm64), macOS (.zip, Intel +
# Apple Silicon, not signed by Apple) and Android (.apk); and the store packages into dist\store: Google Play (.aab) and
# Microsoft Store (.appx, signed by the Store when it's published).
#   powershell -ExecutionPolicy Bypass -File build-apps.ps1
#   ... -Only windows,android                 (just some of them: windows, store, unix (Linux + Mac), android)
#   ... -Upload -Ip 84.13.68.152 -Key C:\path\to\ssh-key.key   (also puts what was built on the server's download page)
#   ... -StoreId <Package/Identity/Name> -StorePublisher <CN=...> [-StorePublisherName "<Publisher display name>"]
#        (only to override the Microsoft Store identity saved in desktop\package.json: TheBlueDucky.CogWild /
#        CN=37C29AB8-... / TheBlueDucky, from Partner Center > the app > Product management > Product identity)
# Before a new release, raise the version in desktop\package.json, android\android\app\build.gradle
# (versionCode + versionName) and the file names in download.html.
param([switch]$Upload, [string]$Ip = '', [string]$Key = '', [string]$User = 'ubuntu', [string]$StoreId = '', [string]$StorePublisher = '', [string]$StorePublisherName = '',
  [ValidateSet('windows', 'store', 'unix', 'android')][string[]]$Only = @('windows', 'store', 'unix', 'android'))
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'android\keys\release.properties'))) { throw 'android\keys\release.properties is missing: the Android release key (see LAUNCH.md)' }
$out = Join-Path $root 'dist\downloads'
$storeOut = Join-Path $root 'dist\store'
New-Item -ItemType Directory -Force $out, $storeOut | Out-Null
$ver = (Get-Content (Join-Path $root 'desktop\package.json') -Raw | ConvertFrom-Json).version
$built = @() # download-page files made this time (only these are uploaded)

Push-Location (Join-Path $root 'desktop')
if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund; if ($LASTEXITCODE) { throw 'npm install failed' } }
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
node copy-game.js
if ($LASTEXITCODE) { throw 'Copying the game into the app failed' }

if ($Only -contains 'windows') {
  Write-Host "==> Windows app $ver"
  npx electron-builder --win
  if ($LASTEXITCODE) { throw 'Windows build failed' }
  Copy-Item "dist\Cogwild-Setup-$ver.exe", "dist\Cogwild-$ver-portable.exe" $out -Force
  $built += "Cogwild-Setup-$ver.exe", "Cogwild-$ver-portable.exe"
}

if ($Only -contains 'store') {
  Write-Host "==> Microsoft Store package $ver"
  # electron-builder's manifest template + internet and microphone (voice chat)
  Copy-Item 'build\appxmanifest.xml' 'node_modules\app-builder-lib\templates\appx\appxmanifest.xml' -Force
  $storeArgs = @('--win', 'appx', '--x64')
  if ($StoreId) { $storeArgs += "-c.appx.identityName=$StoreId" }
  if ($StorePublisher) { $storeArgs += "-c.appx.publisher=$StorePublisher" }
  if ($StorePublisherName) { $storeArgs += "-c.appx.publisherDisplayName=$StorePublisherName" }
  npx electron-builder @storeArgs
  if ($LASTEXITCODE) { throw 'Microsoft Store build failed' }
  Copy-Item "dist\Cogwild-$ver-store.appx" $storeOut -Force
  # the identity reserved in Partner Center (TheBlueDucky.CogWild, Store ID 9P58PTK2Z93L) is the default in desktop\package.json
}

if ($Only -contains 'unix') {
  Write-Host "==> Linux and macOS apps $ver"
  npx electron-builder --linux dir --x64 --arm64
  if ($LASTEXITCODE) { throw 'Linux build failed' }
  # Electron's official Mac app (checked against its published checksums), then packed with the game inside
  $mac = node -e "const { downloadArtifact } = require('@electron/get'); (async () => { const v = require('electron/package.json').version; for (const arch of ['x64', 'arm64']) console.log(await downloadArtifact({ version: v, platform: 'darwin', arch, artifactName: 'electron' })); })().catch((e) => { console.error(e.message); process.exit(1); })"
  if ($LASTEXITCODE) { throw 'Downloading the Mac version of Electron failed' }
  python -I pack-unix.py $ver $out $mac[0] $mac[1]
  if ($LASTEXITCODE) { throw 'Packing the Linux and Mac apps failed' }
  $built += "Cogwild-$ver-linux-x64.tar.gz", "Cogwild-$ver-linux-arm64.tar.gz", "Cogwild-$ver-mac-x64.zip", "Cogwild-$ver-mac-arm64.zip"
}
Pop-Location

if ($Only -contains 'android') {
  Write-Host "==> Android app $ver"
  Push-Location (Join-Path $root 'android')
  if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund; if ($LASTEXITCODE) { throw 'npm install failed' } }
  npm run sync
  if ($LASTEXITCODE) { throw 'Android sync failed' }
  Push-Location android
  # signed with android\keys (release.properties): the .aab is what Google Play wants, the .apk is for the download page
  # --no-daemon: a Gradle helper left running would keep a background release "running" after it finished
  .\gradlew.bat assembleRelease bundleRelease --console=plain --no-daemon
  if ($LASTEXITCODE) { throw 'Android build failed' }
  Copy-Item 'app\build\outputs\apk\release\app-release.apk' (Join-Path $out "Cogwild-$ver.apk") -Force
  Copy-Item 'app\build\outputs\bundle\release\app-release.aab' (Join-Path $storeOut "Cogwild-$ver.aab") -Force
  Pop-Location; Pop-Location
  $built += "Cogwild-$ver.apk"
}

$built | ForEach-Object { '{0,-36} {1,6:N1} MB' -f $_, ((Get-Item (Join-Path $out $_)).Length / 1MB) }

if ($Upload -and $built.Count) {
  if (-not $Ip -or -not $Key) { throw 'Upload needs -Ip and -Key' }
  Write-Host "==> Uploading to $User@$Ip"
  $sshOpts = @('-i', $Key, '-o', 'StrictHostKeyChecking=accept-new')
  scp @sshOpts ($built | ForEach-Object { Join-Path $out $_ }) "${User}@${Ip}:/tmp/"
  if ($LASTEXITCODE) { throw 'Upload failed' }
  $names = $built -join ' '
  ssh @sshOpts "$User@$Ip" "cd /tmp && sudo mkdir -p /opt/cogwild/downloads && sudo mv $names /opt/cogwild/downloads/ && sudo chown -R cogwild:cogwild /opt/cogwild/downloads && ls -la /opt/cogwild/downloads"
  if ($LASTEXITCODE) { throw 'Moving the files into place failed' }
}
Write-Host 'Done!'
