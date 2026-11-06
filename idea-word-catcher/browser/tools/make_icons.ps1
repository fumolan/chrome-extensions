# Regenerate extension icons (amber rounded square + dark "W").
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File make_icons.ps1
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\icons"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = 2 * $r
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

foreach ($s in 16, 32, 48, 128) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

    $bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(232, 163, 61))
    $round = [float]($s * 0.22)
    $path = New-RoundedRect 0 0 $s $s $round
    $g.FillPath($bg, $path)

    $fg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(59, 46, 0))
    $font = New-Object System.Drawing.Font("Segoe UI", [float]($s * 0.6), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF(0, [float](-$s * 0.03), $s, $s)
    $g.DrawString("W", $font, $fg, $rect, $fmt)

    $target = Join-Path $outDir "icon$s.png"
    $bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "generated $target"
}
