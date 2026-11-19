param([string]$InputFile, [int]$Page, [string]$OutputFile)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType=WindowsRuntime]
$null = [Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapEncoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
$resultMethod = $methods | Where-Object { $_.IsGenericMethodDefinition -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation?1' } | Select-Object -First 1
$actionMethod = $methods | Where-Object { !$_.IsGenericMethod -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
function Await-Result($Operation, $Type) {
  $task = $resultMethod.MakeGenericMethod($Type).Invoke($null, @($Operation))
  $task.GetAwaiter().GetResult()
}
$file = Await-Result ([Windows.Storage.StorageFile]::GetFileFromPathAsync($InputFile)) ([Windows.Storage.StorageFile])
$pdf = Await-Result ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
$pageObject = $pdf.GetPage($Page)
$stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
try {
  $options = [Windows.Data.Pdf.PdfPageRenderOptions]::new()
  $options.BitmapEncoderId = [Windows.Graphics.Imaging.BitmapEncoder]::PngEncoderId
  $scale = 1800 / [Math]::Max($pageObject.Size.Width, $pageObject.Size.Height)
  $options.DestinationWidth = [uint32][Math]::Max(1, [Math]::Round($pageObject.Size.Width * $scale))
  $options.DestinationHeight = [uint32][Math]::Max(1, [Math]::Round($pageObject.Size.Height * $scale))
  $task = $actionMethod.Invoke($null, @($pageObject.RenderToStreamAsync($stream, $options)))
  $task.GetAwaiter().GetResult()
  $stream.Seek(0)
  $reader = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
  $target = [IO.File]::Open($OutputFile, [IO.FileMode]::CreateNew)
  try { $reader.CopyTo($target) } finally { $target.Dispose(); $reader.Dispose() }
} finally {
  $stream.Dispose()
  $pageObject.Dispose()
}
