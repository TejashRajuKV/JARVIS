# Installs OFFLINE SPEECH for JARVIS lecture mode: the whisper.cpp program and one speech model, into the ".whisper" folder next to this file.
# Run it yourself (right-click -> Run with PowerShell). JARVIS never downloads anything on its own.
#
#   What it downloads (you are asked before anything is fetched):
#     1. The whisper.cpp program for Windows (CPU), a zip of a few MB, from the official GitHub releases of ggml-org/whisper.cpp
#     2. One speech model file, "ggml-base.en.bin" (about 150 MB, English), from huggingface.co/ggerganov/whisper.cpp
#   Choose another model with -Model (tiny.en is ~75 MB and faster but less accurate; small.en is ~470 MB, slower but more accurate).
#   Nothing is installed system-wide and no admin rights are needed. Delete the ".whisper" folder to remove it.
#   After it finishes it prints the SHA-256 of each file so you can compare them with the ones published on the download pages.
param([string]$Model = 'base.en', [string]$Dir = '', [switch]$Yes)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Dir) { $Dir = if ($env:JARVIS_WHISPER_DIR) { $env:JARVIS_WHISPER_DIR } else { Join-Path $here '.whisper' } }
if ($Model -notmatch '^(tiny|base|small)(\.en)?$') { Write-Host "Unknown model '$Model'. Use tiny.en, base.en, small.en, tiny, base or small." -ForegroundColor Red; exit 1 }
$modelFile = "ggml-$Model.bin"
$modelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$modelFile"
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
Write-Host ""
Write-Host "JARVIS offline speech" -ForegroundColor Cyan
Write-Host "  Folder : $Dir"
Write-Host "  Program: whisper.cpp for Windows (a zip of a few MB) from https://github.com/ggml-org/whisper.cpp/releases"
$mb = if ($Model -match '^tiny') { 75 } elseif ($Model -match '^base') { 150 } else { 470 }
Write-Host "  Model  : $modelFile (about $mb MB) from $modelUrl"
Write-Host ""
if (-not $Yes) { $a = Read-Host 'Download these now? (y/N)'; if ($a -notmatch '^(y|yes)$') { Write-Host 'Cancelled. Nothing was downloaded.'; exit 0 } }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Get-File($url, $out) {
  Write-Host "Downloading $(Split-Path -Leaf $out) ..."
  $tmp = "$out.part"
  Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -Headers @{ 'User-Agent' = 'jarvis-install-whisper' }
  Move-Item -Force $tmp $out
}
# 1. the program
$exe = Get-ChildItem -Path $Dir -Recurse -Filter 'whisper-cli.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) {
  $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest' -Headers @{ 'User-Agent' = 'jarvis-install-whisper' }
  $asset = $rel.assets | Where-Object { $_.name -eq 'whisper-bin-x64.zip' } | Select-Object -First 1
  if (-not $asset) { Write-Host "The latest release ($($rel.tag_name)) has no 'whisper-bin-x64.zip'. Download a Windows CPU build by hand from https://github.com/ggml-org/whisper.cpp/releases and unzip it into $Dir" -ForegroundColor Yellow; exit 1 }
  $zip = Join-Path $Dir $asset.name
  Get-File $asset.browser_download_url $zip
  Expand-Archive -Path $zip -DestinationPath $Dir -Force
  Remove-Item $zip -Force
  $exe = Get-ChildItem -Path $Dir -Recurse -Filter 'whisper-cli.exe' | Select-Object -First 1
  if (-not $exe) { Write-Host "Unzipped, but whisper-cli.exe was not found in $Dir." -ForegroundColor Red; exit 1 }
}
# 2. the model
$modelPath = Join-Path $Dir $modelFile
if (-not (Test-Path $modelPath)) { Get-File $modelUrl $modelPath }
Write-Host ""
Write-Host "Installed." -ForegroundColor Green
foreach ($f in @($exe.FullName, $modelPath)) { $h = (Get-FileHash -Algorithm SHA256 $f).Hash; Write-Host ("  {0}  SHA-256 {1}" -f (Split-Path -Leaf $f), $h) }
Write-Host ""
Write-Host "Now tell JARVIS: 'turn on offline speech'. Then 'start lecture mode for DBMS' will keep the audio on this laptop."
