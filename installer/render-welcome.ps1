Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root 'src\assets\backgrounds\abstract-glass.png'
$logoPath = Join-Path $root 'flowricondark.png'
$outputPath = Join-Path $PSScriptRoot 'flowr-welcome.bmp'
$width = 1100
$height = 680

$canvas = New-Object System.Drawing.Bitmap($width, $height)
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::FromArgb(10, 11, 16))

$art = [System.Drawing.Image]::FromFile($sourcePath)
$crop = New-Object System.Drawing.Rectangle(730, 0, 940, 952)
$dest = New-Object System.Drawing.Rectangle(550, 0, 550, 680)
$g.DrawImage($art, $dest, $crop, [System.Drawing.GraphicsUnit]::Pixel)

$fadeRect = New-Object System.Drawing.Rectangle(390, 0, 710, 680)
$fade = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $fadeRect,
  [System.Drawing.Color]::FromArgb(255, 10, 11, 16),
  [System.Drawing.Color]::FromArgb(0, 10, 11, 16),
  [System.Drawing.Drawing2D.LinearGradientMode]::Horizontal
)
$g.FillRectangle($fade, $fadeRect)
$leftShade = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(244, 10, 11, 16))
$g.FillRectangle($leftShade, 0, 0, 430, 680)
$bottomShade = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(120, 6, 7, 10))
$g.FillRectangle($bottomShade, 0, 610, 1100, 70)

$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(247, 247, 250))
$muted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(166, 171, 185))
$violet = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(174, 158, 255))
$line = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(48, 255, 255, 255), 1)
$titleFont = New-Object System.Drawing.Font('Segoe UI', 48, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$bodyFont = New-Object System.Drawing.Font('Segoe UI', 18, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$smallFont = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$featureFont = New-Object System.Drawing.Font('Segoe UI', 15, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$brandFont = New-Object System.Drawing.Font('Segoe UI', 21, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)

$logo = [System.Drawing.Image]::FromFile($logoPath)
$g.DrawImage($logo, 52, 43, 38, 38)
$g.DrawString('Flowr', $brandFont, $white, 102, 49)
$g.DrawString('TIEDDR  /  VERSION 1.1', $smallFont, $muted, 878, 55)

$g.DrawString('BROWSER FOR YOUR FLOW', $smallFont, $violet, 55, 151)
$g.DrawString('Install Flowr.', $titleFont, $white, 50, 185)
$bodyFormat = New-Object System.Drawing.StringFormat
$bodyFormat.Trimming = [System.Drawing.StringTrimming]::Word
$bodyRect = New-Object System.Drawing.RectangleF(55, 258, 425, 70)
$g.DrawString('A calmer, faster browser with your Tieddr world already connected.', $bodyFont, $muted, $bodyRect, $bodyFormat)

$features = @(
  'Vault passwords, cards and autofill built in',
  'Space bookmarks and notes kept close',
  'Mavis available from every new tab'
)
$featureY = 370
foreach ($feature in $features) {
  $g.DrawEllipse($line, 57, $featureY, 22, 22)
  $g.DrawLine($line, 64, $featureY + 11, 69, $featureY + 16)
  $g.DrawLine($line, 69, $featureY + 16, 74, $featureY + 7)
  $g.DrawString($feature, $featureFont, $white, 94, $featureY + 1)
  $featureY += 54
}

$g.DrawLine($line, 55, 590, 490, 590)
$g.DrawString('Windows 10 and 11', $smallFont, $muted, 55, 610)
$g.DrawString('Private. Personal. Yours.', $smallFont, $muted, 330, 610)

$canvas.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Bmp)

$logo.Dispose(); $art.Dispose(); $fade.Dispose(); $leftShade.Dispose(); $bottomShade.Dispose()
$white.Dispose(); $muted.Dispose(); $violet.Dispose(); $line.Dispose()
$titleFont.Dispose(); $bodyFont.Dispose(); $smallFont.Dispose(); $featureFont.Dispose(); $brandFont.Dispose()
$g.Dispose(); $canvas.Dispose()
Write-Output $outputPath
