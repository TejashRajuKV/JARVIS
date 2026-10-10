# Keeps JARVIS running (opt-in: Settings -> "Keep JARVIS running"). Windows Task Scheduler runs this every 5 minutes (through keepalive.vbs, so no
# window flashes). If JARVIS is not answering it starts it again WITHOUT opening the browser, and leaves a note for the page to show.
# It never restarts JARVIS that you stopped on purpose ("Stop JARVIS", Settings -> Stop): that leaves ~/jarvis/.stopped-by-user until you start it again.
# -DryRun prints what it WOULD do as one line (used by the tests). ASCII only (Windows PowerShell 5.1).
param([switch]$DryRun)
$ErrorActionPreference = 'SilentlyContinue'
$AppData = Join-Path $env:USERPROFILE 'jarvis'
$Flag = Join-Path $AppData '.keepalive.json'
$Stopped = Join-Path $AppData '.stopped-by-user'
$Lock = Join-Path $AppData '.jarvis.lock'
$Note = Join-Path $AppData '.restarted.json'
$Log = Join-Path $AppData '.keepalive.log'

function Done($what) { if ($DryRun) { Write-Output $what } ; exit 0 }
function Log($t) { try { Add-Content -Path $Log -Value ("{0}  {1}" -f (Get-Date -Format s), $t) } catch {} }

if (-not (Test-Path $Flag)) { Done 'off' }
if (Test-Path $Stopped) { Done 'stopped-by-user' }

# Is a JARVIS answering? The lock file says which port; ask it (and only believe an answer that says it is JARVIS).
function Answers($port) {
  try { $r = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 4; return [bool]($r -and $r.status -eq 'online') } catch { return $false }
}
$ports = @()
try { $lk = Get-Content $Lock -Raw | ConvertFrom-Json; if ($lk.port) { $ports += [int]$lk.port } } catch {}
$range = 3000..3010
if ($env:JARVIS_KEEPALIVE_PORTS) { $range = @($env:JARVIS_KEEPALIVE_PORTS -split ',' | ForEach-Object { [int]$_ }) }   # (the tests point it at a port of their own)
foreach ($p in $range) { if ($ports -notcontains $p) { $ports += $p } }
foreach ($p in $ports) { if (Answers $p) { Done 'alive' } }

# Not running. Do not stack up launches: a launch started in the last 3 minutes is given time to finish.
try { if (Test-Path $Note) { $n = Get-Content $Note -Raw | ConvertFrom-Json; if ($n.at -and ((Get-Date) - [datetime]$n.at).TotalMinutes -lt 3) { Done 'starting' } } } catch {}
if ($DryRun) { Done 'restart' }

Log 'JARVIS was not answering - starting it again'
try { Set-Content -Path $Note -Value (@{ at = (Get-Date -Format s); acked = $false } | ConvertTo-Json -Compress) -Encoding ASCII } catch {}
$start = Join-Path $PSScriptRoot 'start.ps1'
Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $start, '-Silent', '-NoBrowser' -WindowStyle Hidden
exit 0
