# Turns on email login (and optionally "Sign in with Google") on the server.
# Run it yourself; it asks for the settings and writes them to /etc/cogwild.env on the server (readable by root only).
#
#   powershell -ExecutionPolicy Bypass -File deploy\set-login.ps1 -Ip 84.13.68.152 -Key C:\path\to\ssh-key.key
#
# Email (pick one):
#   Gmail:   turn on 2-Step Verification, then make an App password (myaccount.google.com > Security > App passwords).
#            Host smtp.gmail.com, port 465, user = your Gmail address, password = the 16-letter app password.
#   Outlook: host smtp-mail.outlook.com, port 587 (needs an account that allows SMTP AUTH).
#   Any other mail service with SMTP works too (Brevo, Zoho, ...).
# Google sign-in (optional here; deploy\set-google.ps1 does only that): see LAUNCH.md > "Turn on Google sign-in".
param(
  [Parameter(Mandatory = $true)][string]$Ip,
  [Parameter(Mandatory = $true)][string]$Key,
  [string]$User = 'ubuntu'
)
$ErrorActionPreference = 'Stop'
$smtpHost = Read-Host 'SMTP host (e.g. smtp.gmail.com)'
$port = Read-Host 'SMTP port (465 or 587)'
$smtpUser = Read-Host 'SMTP user (your email address)'
$secure = Read-Host 'SMTP password / app password' -AsSecureString
$pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$from = Read-Host "From (e.g. Cogwild <$smtpUser>)"
if (-not $from) { $from = "Cogwild <$smtpUser>" }
$gid = Read-Host 'Google OAuth client ID (Enter to skip)'

$lines = @("MAIL_SMTP_HOST=$smtpHost", "MAIL_SMTP_PORT=$port", "MAIL_SMTP_USER=$smtpUser", "MAIL_SMTP_PASS=$pass", "MAIL_FROM=$from")
if ($gid) { $lines += "GOOGLE_CLIENT_ID=$gid" }
$env = ($lines -join "`n") + "`n"

$sshOpts = @('-i', $Key, '-o', 'StrictHostKeyChecking=accept-new')
# keeps the other settings in the file (voice relay, Google, ...): only the mail lines (and Google, if given) are replaced
$drop = if ($gid) { '^(MAIL_|GOOGLE_CLIENT_ID=)' } else { '^MAIL_' }
$env | ssh @sshOpts "$User@$Ip" "umask 077; sudo touch /etc/cogwild.env && sudo grep -v -E '$drop' /etc/cogwild.env > /tmp/cw.env; cat >> /tmp/cw.env && sudo install -m 600 -o root -g root /tmp/cw.env /etc/cogwild.env && rm -f /tmp/cw.env && sudo systemctl restart cogwild && sleep 2 && curl -fsS http://127.0.0.1:8765/health"
if ($LASTEXITCODE -ne 0) { throw 'Could not update the server' }
Write-Host ''
Write-Host 'Done. Open the game: it now asks everyone to log in with their email (and Google, if you added the client ID).'
