# Uploads Cogwild to your Oracle Cloud VM and installs/updates it (run this again after every change).
#
#   powershell -ExecutionPolicy Bypass -File deploy\upload.ps1 -Ip 1.2.3.4 -Key C:\path\to\ssh-key.key
#   ... -User opc                  (Oracle Linux images use "opc", Ubuntu images use "ubuntu")
#   ... -Domain play.mygame.com    (optional: your own domain instead of <ip>.sslip.io)
param(
  [Parameter(Mandatory = $true)][string]$Ip,
  [Parameter(Mandatory = $true)][string]$Key,
  [string]$User = 'ubuntu',
  [string]$Domain = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pack = Join-Path $env:TEMP 'cogwild-upload.tgz'

Write-Host "Packing the game..."
if (Test-Path $pack) { Remove-Item -Force $pack }
$files = @('index.html', 'auth.html', 'favicon.svg', 'js', 'fonts', 'img', 'server', 'deploy')
foreach ($f in 'privacy.html', 'terms.html', 'credits.html', 'download.html', 'manifest.webmanifest', 'sw.js') { if (Test-Path (Join-Path $root $f)) { $files += $f } }
tar -czf $pack -C $root @files
if ($LASTEXITCODE -ne 0) { throw 'Packing failed' }

$target = "$User@$Ip"
$sshOpts = @('-i', $Key, '-o', 'StrictHostKeyChecking=accept-new')
Write-Host "Uploading to $target..."
scp @sshOpts $pack "${target}:/tmp/cogwild.tgz"
if ($LASTEXITCODE -ne 0) { throw 'Upload failed (check the IP, user name and key file)' }

Write-Host "Installing on the server (the first time takes a few minutes)..."
$remote = "rm -rf ~/cogwild-src && mkdir -p ~/cogwild-src && tar -xzf /tmp/cogwild.tgz -C ~/cogwild-src && sed -i 's/\r$//' ~/cogwild-src/deploy/setup.sh && sudo bash ~/cogwild-src/deploy/setup.sh $Domain"
ssh @sshOpts $target $remote
if ($LASTEXITCODE -ne 0) { throw 'Setup on the server failed: see the messages above' }
Remove-Item -Force $pack
Write-Host "Done!"
