# Stops the background JARVIS server started by the no-window launcher ("Stop JARVIS" on the desktop,
# or Settings - Data - Stop inside the app). Safe: the saved PID is only killed if it really is a Node
# process; otherwise JARVIS is found on its sole port 3002. ASCII only (Windows PowerShell 5.1).
$ErrorActionPreference = 'Stop'
$AppData = Join-Path $env:USERPROFILE 'jarvis'
$PidFile = Join-Path $AppData '.jarvis.pid'
$LockFile = Join-Path $AppData '.jarvis.lock'
$ServerFile = Join-Path $PSScriptRoot 'server.js'

function TestNode($id) {
  try { return ((Get-Process -Id $id -ErrorAction Stop).ProcessName -match '^node(\.exe)?$') } catch { return $false }
}
# Only a Node process that is running JARVIS's server.js counts - never some other Node program on a nearby port.
function IsJarvisNode($id) {
  try {
    $c = (Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction Stop).CommandLine
    $exact = '(^|[\s"''])' + [regex]::Escape($ServerFile) + '($|[\s"''])'
    if ($c -match $exact) { return $true }
    # Terminal launches may use a relative script name. Require the live server's
    # PID, fixed port and private home to agree; a generic server.js is not enough.
    if ($c -notmatch '(^|[\\/\s])"?server\.js("|\s|$)') { return $false }
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3002/api/health' -TimeoutSec 5
    return [bool]($health.status -eq 'online' -and [int]$health.pid -eq $id -and
      [int]$health.port -eq 3002 -and [IO.Path]::GetFullPath($health.sandbox) -eq [IO.Path]::GetFullPath($AppData))
  } catch { return $false }
}
function StopId($id) { try { Stop-Process -Id $id -Force -ErrorAction Stop; return $true } catch { return $false } }

function StillListening($p) {
  try { return [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1) } catch { return $false }
}
$stopped = $false
# Stopped on purpose: the keep-alive task (keepalive.ps1) must not start JARVIS again until you do.
try { New-Item -ItemType Directory -Force -Path $AppData | Out-Null; Set-Content -Path (Join-Path $AppData '.stopped-by-user') -Value (Get-Date -Format s) -Encoding ASCII } catch {}
# The server writes its own pid into the lock file (and the pid file), so start there.
if (Test-Path $LockFile) {
  $lid = $null
  try { $lid = [int]((Get-Content $LockFile -Raw | ConvertFrom-Json).pid) } catch {}
  if ($lid -and (TestNode $lid) -and (IsJarvisNode $lid)) { if (StopId $lid) { $stopped = $true } }
  Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
}
if (Test-Path $PidFile) {
  $id = $null
  try { $id = [int](Get-Content $PidFile -TotalCount 1) } catch {}
  if ($id -and (TestNode $id) -and (IsJarvisNode $id)) { if (StopId $id) { $stopped = $true } }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}
# Fallback: JARVIS started from a terminal has no PID file - find it by its port instead.
# After any kill, VERIFY the port really went quiet; retry once with taskkill before giving up.
foreach ($p in @(3002)) {
  if (-not (StillListening $p)) { continue }
  try {
    $owners = (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
    foreach ($op in $owners) { if ($op -and (TestNode $op) -and (IsJarvisNode $op)) { [void](StopId $op) } }
  } catch {}
  Start-Sleep -Milliseconds 600
  if (StillListening $p) { try { $op2 = (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess; if ($op2 -and (TestNode $op2) -and (IsJarvisNode $op2)) { taskkill /F /PID $op2 2>$null | Out-Null; Start-Sleep -Milliseconds 600 } } catch {} }
  if (-not (StillListening $p)) { $stopped = $true }
  break
}
Write-Host ''
if ($stopped) { Write-Host '  JARVIS stopped.' -ForegroundColor Green } else { Write-Host '  JARVIS is not running.' -ForegroundColor Yellow }
Start-Sleep -Seconds 2
