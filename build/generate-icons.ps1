param(
  [string]$Source = (Join-Path $PSScriptRoot '..\flowricondark.png'),
  [string]$Output = (Join-Path $PSScriptRoot 'icons\flowr-transparent.png')
)

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies 'System.Drawing.dll' -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class FlowrIconAlpha {
  public static void ExtractWhite(string input, string output) {
    using (var sourceImage = new Bitmap(input)) {
      var canvasSize = Math.Max(sourceImage.Width, sourceImage.Height);
      using (var destination = new Bitmap(canvasSize, canvasSize, PixelFormat.Format32bppArgb)) {
      var sourceRectangle = new Rectangle(0, 0, sourceImage.Width, sourceImage.Height);
      var destinationRectangle = new Rectangle(0, 0, canvasSize, canvasSize);
      var sourceData = sourceImage.LockBits(sourceRectangle, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      var destinationData = destination.LockBits(destinationRectangle, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
      var sourceByteCount = Math.Abs(sourceData.Stride) * sourceImage.Height;
      var destinationByteCount = Math.Abs(destinationData.Stride) * canvasSize;
      var source = new byte[sourceByteCount];
      var target = new byte[destinationByteCount];
      Marshal.Copy(sourceData.Scan0, source, 0, sourceByteCount);

      for (var y = 0; y < sourceImage.Height; y++) {
        for (var x = 0; x < sourceImage.Width; x++) {
          var sourceIndex = y * sourceData.Stride + x * 4;
          var targetIndex = y * destinationData.Stride + x * 4;
          var luminance = Math.Max(source[sourceIndex], Math.Max(source[sourceIndex + 1], source[sourceIndex + 2]));
          var alpha = (source[sourceIndex + 3] * luminance + 127) / 255;
          // Flowr lime stays legible on both light and dark desktop surfaces.
          // BGRA byte order: #C9FF51 -> B=0x51, G=0xFF, R=0xC9.
          target[targetIndex] = 0x51;
          target[targetIndex + 1] = 0xFF;
          target[targetIndex + 2] = 0xC9;
          target[targetIndex + 3] = (byte)alpha;
        }
      }

      Marshal.Copy(target, 0, destinationData.Scan0, destinationByteCount);
      sourceImage.UnlockBits(sourceData);
      destination.UnlockBits(destinationData);
      Directory.CreateDirectory(Path.GetDirectoryName(output));
      destination.Save(output, ImageFormat.Png);
      }
    }
  }
}
'@

$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$outputPath = [IO.Path]::GetFullPath($Output)
[FlowrIconAlpha]::ExtractWhite($sourcePath, $outputPath)
Write-Output $outputPath
