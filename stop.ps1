# Stops the background JARVIS server started by the no-window launcher ("Stop JARVIS" on the desktop,
# or Settings - Data - Stop inside the app). Safe: the saved PID is only killed if it really is a Node
# process; otherwise JARVIS is found by its port (3000-3010). ASCII only (Windows PowerShell 5.1).
$ErrorActionPreference = 'Stop'
$PidFile = Join-Path (Join-Path $env:USERPROFILE 'jarvis') '.jarvis.pid'

function TestNode($id) {
  try { return ((Get-Process -Id $id -ErrorAction Stop).ProcessName -match '^node(\.exe)?$') } catch { return $false }
}
function StopId($id) { try { Stop-Process -Id $id -Force -ErrorAction Stop; return $true } catch { return $false } }

function StillListening($p) {
  try { return [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1) } catch { return $false }
}
$stopped = $false
if (Test-Path $PidFile) {
  $id = $null
  try { $id = [int](Get-Content $PidFile -TotalCount 1) } catch {}
  if ($id -and (TestNode $id)) { $stopped = StopId $id }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}
# Fallback: JARVIS started from a terminal has no PID file - find it by its port instead.
# After any kill, VERIFY the port really went quiet; retry once with taskkill before giving up.
foreach ($p in 3000..3010) {
  if (-not (StillListening $p)) { continue }
  try {
    $owners = (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
    foreach ($op in $owners) { if ($op -and (TestNode $op)) { [void](StopId $op) } }
  } catch {}
  Start-Sleep -Milliseconds 600
  if (StillListening $p) { try { $op2 = (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess; if ($op2) { taskkill /F /PID $op2 2>$null | Out-Null; Start-Sleep -Milliseconds 600 } } catch {} }
  if (-not (StillListening $p)) { $stopped = $true }
  break
}
Write-Host ''
if ($stopped) { Write-Host '  JARVIS stopped.' -ForegroundColor Green } else { Write-Host '  JARVIS is not running.' -ForegroundColor Yellow }
Start-Sleep -Seconds 2
