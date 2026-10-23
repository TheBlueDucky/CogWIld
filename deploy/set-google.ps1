# Turns on "Sign up / Log in with Google" on the server (the game opens the player's own browser for it).
#
#   powershell -ExecutionPolicy Bypass -File deploy\set-google.ps1 -Ip 150.136.43.207 -Key C:\path\to\ssh-key.key -ClientId 1234-abc.apps.googleusercontent.com
#
# The client ID comes from Google Cloud Console (see LAUNCH.md > "Turn on Google sign-in"). It is not a secret
# (Google shows it in the sign-in address), so it can be passed on the command line. Other settings stay as they are.
param(
  [Parameter(Mandatory = $true)][string]$Ip,
  [Parameter(Mandatory = $true)][string]$Key,
  [Parameter(Mandatory = $true)][string]$ClientId,
  [string]$User = 'ubuntu'
)
$ErrorActionPreference = 'Stop'
if ($ClientId -notmatch '^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$') { throw "That doesn't look like a Google client ID (it ends in .apps.googleusercontent.com)" }
$sshOpts = @('-i', $Key, '-o', 'StrictHostKeyChecking=accept-new')
$cmd = "sudo touch /etc/cogwild.env && sudo sed -i '/^GOOGLE_CLIENT_ID=/d' /etc/cogwild.env && echo 'GOOGLE_CLIENT_ID=$ClientId' | sudo tee -a /etc/cogwild.env >/dev/null && sudo chmod 600 /etc/cogwild.env && sudo systemctl restart cogwild && sleep 2 && curl -fsS http://127.0.0.1:8765/health"
ssh @sshOpts "$User@$Ip" $cmd
if ($LASTEXITCODE -ne 0) { throw 'Could not update the server' }
Write-Host ''
Write-Host 'Done. New players now sign up with Google in their browser.'
