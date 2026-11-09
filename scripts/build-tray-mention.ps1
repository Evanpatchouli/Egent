Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot '../apps/desktop/assets/icon.png'))
$bitmap = [System.Drawing.Bitmap]::new(64, 64, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.DrawImage($source, 0, 0, 64, 64)
  $graphics.FillEllipse([System.Drawing.Brushes]::White, 42, 1, 21, 21)
  $red = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(220, 38, 38))
  try { $graphics.FillEllipse($red, 45, 4, 15, 15) } finally { $red.Dispose() }
  $bitmap.Save((Join-Path $PSScriptRoot '../apps/desktop/assets/tray-mention.png'), [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
  $source.Dispose()
}
