# Draws the Cogwild cog icon (same design as favicon.svg) as PNGs for the Windows and Android apps.
#   powershell -ExecutionPolicy Bypass -File deploy\make-icons.ps1
# Writes desktop\build\icon.png (512) and, when android\ exists, every Android launcher icon size.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot

# size = picture size; scale = how big the 64-unit design is drawn; bg = draw the dark rounded square
function Draw-Icon([string]$file, [int]$size, [double]$scale, [bool]$bg, [bool]$round) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $u = $size * $scale / 64.0 # one design unit in pixels
  $c = $size / 2.0
  $dark = [System.Drawing.ColorTranslator]::FromHtml('#141a2e')
  $gold = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#ffc43d'))
  $blue = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#3a86ff'))
  if ($bg) {
    $b = New-Object System.Drawing.SolidBrush $dark
    if ($round) { $g.FillEllipse($b, 0, 0, $size, $size) }
    else {
      $r = 14 * $u * 2; $s = 64 * $u; $o = $c - $s / 2
      $p = New-Object System.Drawing.Drawing2D.GraphicsPath
      $p.AddArc($o, $o, $r, $r, 180, 90); $p.AddArc($o + $s - $r, $o, $r, $r, 270, 90)
      $p.AddArc($o + $s - $r, $o + $s - $r, $r, $r, 0, 90); $p.AddArc($o, $o + $s - $r, $r, $r, 90, 90)
      $p.CloseFigure(); $g.FillPath($b, $p)
    }
  }
  # the cog: a circle with 8 teeth
  $g.FillEllipse($gold, $c - 15 * $u, $c - 15 * $u, 30 * $u, 30 * $u)
  for ($i = 0; $i -lt 8; $i++) {
    $st = $g.Save()
    $g.TranslateTransform($c, $c); $g.RotateTransform(45 * $i)
    $tooth = New-Object System.Drawing.Drawing2D.GraphicsPath
    $x = -4 * $u; $y = -25 * $u; $w = 8 * $u; $h = 12 * $u; $r = 2 * $u * 2
    $tooth.AddArc($x, $y, $r, $r, 180, 90); $tooth.AddArc($x + $w - $r, $y, $r, $r, 270, 90)
    $tooth.AddArc($x + $w - $r, $y + $h - $r, $r, $r, 0, 90); $tooth.AddArc($x, $y + $h - $r, $r, $r, 90, 90)
    $tooth.CloseFigure(); $g.FillPath($gold, $tooth)
    $g.Restore($st)
  }
  $g.FillEllipse($blue, $c - 6 * $u, $c - 6 * $u, 12 * $u, 12 * $u)
  New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

Draw-Icon (Join-Path $root 'desktop\build\icon.png') 512 1.0 $true $false
Write-Host 'desktop\build\icon.png'

# web app (installable website) icons; "maskable" keeps the cog inside the safe circle phones crop to
Draw-Icon (Join-Path $root 'img\icon-192.png') 192 1.0 $true $false
Draw-Icon (Join-Path $root 'img\icon-512.png') 512 1.0 $true $false
Draw-Icon (Join-Path $root 'img\apple-touch-icon.png') 180 1.0 $true $false
$m = Join-Path $root 'img\icon-maskable-512.png'
Draw-Icon $m 512 0.72 $false $false
# maskable icons need a full-bleed background: paint it under the cog
$bmp = [System.Drawing.Image]::FromFile($m); $full = New-Object System.Drawing.Bitmap 512, 512
$g = [System.Drawing.Graphics]::FromImage($full); $g.Clear([System.Drawing.ColorTranslator]::FromHtml('#141a2e')); $g.DrawImage($bmp, 0, 0, 512, 512); $g.Dispose(); $bmp.Dispose()
$full.Save($m, [System.Drawing.Imaging.ImageFormat]::Png); $full.Dispose()
Write-Host 'img\icon-*.png'

$res = Join-Path $root 'android\android\app\src\main\res'
if (Test-Path $res) {
  # legacy icons (48dp) and adaptive-icon foregrounds (108dp, cog inside the 72dp safe zone)
  $dens = @{ 'mdpi' = 1; 'hdpi' = 1.5; 'xhdpi' = 2; 'xxhdpi' = 3; 'xxxhdpi' = 4 }
  foreach ($d in $dens.Keys) {
    $k = $dens[$d]
    Draw-Icon (Join-Path $res "mipmap-$d\ic_launcher.png") ([int](48 * $k)) 1.0 $true $false
    Draw-Icon (Join-Path $res "mipmap-$d\ic_launcher_round.png") ([int](48 * $k)) 0.92 $true $true
    Draw-Icon (Join-Path $res "mipmap-$d\ic_launcher_foreground.png") ([int](108 * $k)) 0.62 $false $false
  }
  Write-Host "Android icons in $res"
}
