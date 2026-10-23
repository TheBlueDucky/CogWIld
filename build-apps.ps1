# Builds the apps into dist\downloads (the download page): Windows (.exe), Linux (.tar.gz, x64 + arm64), macOS (.zip, Intel +
# Apple Silicon, not signed by Apple) and Android (.apk); and the store packages into dist\store: Google Play (.aab) and
# Microsoft Store (.appx, signed by the Store when it's published).
#   powershell -ExecutionPolicy Bypass -File build-apps.ps1
#   ... -Upload -Ip 150.136.43.207 -Key C:\path\to\ssh-key.key   (also puts them on the server's download page)
#   ... -StoreId <Package/Identity/Name> -StorePublisher <CN=...>   (the Microsoft Store values from Partner Center >
#        the app > Product management > Product identity; without them the .appx has placeholders and the Store refuses it)
# Before a new release, raise the version in desktop\package.json, android\android\app\build.gradle
# (versionCode + versionName) and the file names in download.html.
param([switch]$Upload, [string]$Ip = '', [string]$Key = '', [string]$User = 'ubuntu', [string]$StoreId = '', [string]$StorePublisher = '')
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

Write-Host "==> Microsoft Store package $ver"
# electron-builder's manifest template + internet and microphone (voice chat)
Copy-Item 'build\appxmanifest.xml' 'node_modules\app-builder-lib\templates\appx\appxmanifest.xml' -Force
$storeArgs = @('--win', 'appx', '--x64')
if ($StoreId) { $storeArgs += "-c.appx.identityName=$StoreId" }
if ($StorePublisher) { $storeArgs += "-c.appx.publisher=$StorePublisher" }
npx electron-builder @storeArgs
if ($LASTEXITCODE) { throw 'Microsoft Store build failed' }
$storeOut = Join-Path $root 'dist\store'
New-Item -ItemType Directory -Force $storeOut | Out-Null
Copy-Item "dist\Cogwild-$ver-store.appx" $storeOut -Force
if (-not $StoreId -or -not $StorePublisher) { Write-Host '   (placeholder Store identity: rebuild with -StoreId and -StorePublisher before uploading it to Partner Center)' }

Write-Host "==> Linux and macOS apps $ver"
npx electron-builder --linux dir --x64 --arm64
if ($LASTEXITCODE) { throw 'Linux build failed' }
# Electron's official Mac app (checked against its published checksums), then packed with the game inside
$mac = node -e "const { downloadArtifact } = require('@electron/get'); (async () => { const v = require('electron/package.json').version; for (const arch of ['x64', 'arm64']) console.log(await downloadArtifact({ version: v, platform: 'darwin', arch, artifactName: 'electron' })); })().catch((e) => { console.error(e.message); process.exit(1); })"
if ($LASTEXITCODE) { throw 'Downloading the Mac version of Electron failed' }
python -I pack-unix.py $ver $out $mac[0] $mac[1]
if ($LASTEXITCODE) { throw 'Packing the Linux and Mac apps failed' }
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
Copy-Item 'app\build\outputs\bundle\release\app-release.aab' (Join-Path $storeOut "Cogwild-$ver.aab") -Force
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
