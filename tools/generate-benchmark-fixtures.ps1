param(
  [int]$Count = 100,
  [int]$Size = 64,
  [string]$Source = "assets\stone-texture.jpg",
  [string]$OutputDir = "assets\benchmark-jpegs"
)

Add-Type -AssemblyName PresentationCore

$sourcePath = (Resolve-Path $Source).Path
$outputPath = Join-Path (Resolve-Path ".") $OutputDir
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

$stream = [System.IO.File]::OpenRead($sourcePath)
$decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create(
  $stream,
  [System.Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat,
  [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
)
$stream.Dispose()

$sourceFrame = $decoder.Frames[0]
$cropSize = [Math]::Min($sourceFrame.PixelWidth, $sourceFrame.PixelHeight)
$maxX = [Math]::Max(0, $sourceFrame.PixelWidth - $cropSize)
$maxY = [Math]::Max(0, $sourceFrame.PixelHeight - $cropSize)
$manifest = @()

for ($index = 0; $index -lt $Count; $index++) {
  $xRatio = (($index * 37) % 101) / 100.0
  $yRatio = (($index * 53) % 101) / 100.0
  $x = [Math]::Min($maxX, [Math]::Floor($maxX * $xRatio))
  $y = [Math]::Min($maxY, [Math]::Floor($maxY * $yRatio))
  $crop = New-Object System.Windows.Int32Rect($x, $y, $cropSize, $cropSize)
  $cropped = New-Object System.Windows.Media.Imaging.CroppedBitmap($sourceFrame, $crop)
  $scale = New-Object System.Windows.Media.ScaleTransform(($Size / $cropSize), ($Size / $cropSize))
  $resized = New-Object System.Windows.Media.Imaging.TransformedBitmap($cropped, $scale)
  $name = "bench-{0:D3}.jpg" -f $index
  $filePath = Join-Path $outputPath $name
  $encoder = New-Object System.Windows.Media.Imaging.JpegBitmapEncoder

  $encoder.QualityLevel = 88
  $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($resized))

  $file = [System.IO.File]::Create($filePath)
  $encoder.Save($file)
  $file.Dispose()

  $manifest += "/$OutputDir/$name".Replace("\", "/")
}

$manifestPath = Join-Path $outputPath "manifest.json"
$manifest | ConvertTo-Json | Set-Content -Path $manifestPath -Encoding UTF8

Write-Host "Generated $Count JPEG fixtures at $outputPath"
Write-Host "Manifest: $manifestPath"
