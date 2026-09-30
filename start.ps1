# One-click launcher: checks Node.js, installs JARVIS's parts the first time, finds a free port,
# makes a desktop shortcut, starts JARVIS and opens it in your browser. ASCII only (Windows PowerShell 5.1).
#
# Normal (double-click "Start JARVIS.bat"): a window shows progress and stays open while JARVIS runs.
# -Silent (used by jarvis-silent.vbs - the desktop shortcut and Startup link point here): NO window at
#   all - the server runs hidden in the background, the browser opens when it is ready, and the PID is
#   saved to ~/jarvis/.jarvis.pid so "Stop JARVIS" can quit it. The chosen port is remembered
#   (~/jarvis/.jarvis-port) so the same address works every time. If something needs attention
#   (Node missing, first-time setup), silent mode shows a message or opens the visible launcher once.
param([switch]$Silent)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$AppData  = Join-Path $env:USERPROFILE 'jarvis'
$PidFile  = Join-Path $AppData '.jarvis.pid'
$PortFile = Join-Path $AppData '.jarvis-port'
$LogFile  = Join-Path $AppData '.launcher.log'

function Say($t, $c = 'Cyan') { if (-not $Silent) { Write-Host $t -ForegroundColor $c } }
# Fire-and-forget popup via wscript (in-process COM Popup can hang in some spawned contexts).
function Msg($t) { try { Start-Process wscript.exe -ArgumentList ('//B "' + (Join-Path $PSScriptRoot 'jarvis-msg.vbs') + '" "JARVIS" "' + ($t -replace '"', '') + '"') } catch {} } # auto-closes after 30s so nothing waits on a click forever
function IsJarvis($p) { try { $r = Invoke-RestMethod -Uri "http://localhost:$p/api/health" -TimeoutSec 2; return [bool]$r } catch { return $false } }
# Hard 400ms cap: on some machines a connect to a closed/dropped port hangs for seconds, which used to
# make the port scan take minutes. Fast when open (<5ms), bounded when closed.
function IsBusy($p) {
  $c = New-Object Net.Sockets.TcpClient
  try { $ok = $c.BeginConnect('127.0.0.1', $p, $null, $null).AsyncWaitHandle.WaitOne(400); if ($ok -and $c.Connected) { return $true } } catch {} finally { $c.Close() }
  return $false
}

Say ''
Say '  J.A.R.V.I.S. - starting up' 'Cyan'
Say ''

# 1. Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  if ($Silent) { Msg 'JARVIS needs a free program called Node.js, which is not installed yet. Double-click "Start JARVIS" once and it will guide you through installing it.'; exit 1 }
  Say '  JARVIS needs a free program called Node.js, and it is not installed yet.' 'Yellow'
  $hasWinget = [bool](Get-Command winget -ErrorAction SilentlyContinue)
  if ($hasWinget) {
    $a = Read-Host '  Install it now automatically? (Y/N)'
    if ($a -match '^[Yy]') {
      winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
      Say ''
      Say '  Node.js is installed. Please CLOSE this window and double-click "Start JARVIS" again.' 'Green'
      Read-Host '  Press Enter to close'; exit 0
    }
  }
  Say '  Opening the download page. Install the "LTS" version, then double-click "Start JARVIS" again.' 'Yellow'
  Start-Process 'https://nodejs.org/en/download'
  Read-Host '  Press Enter to close'; exit 0
}

# 2. First-time install of JARVIS's own parts (silent mode can't show progress, so open the visible one once)
if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules\express'))) {
  if ($Silent) { Start-Process -WindowStyle Minimized (Join-Path $PSScriptRoot 'Start JARVIS.bat'); exit 0 }
  Say '  First-time setup - this takes about a minute...' 'Yellow'
  npm install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Say '  Setup failed. Check your internet connection and try again.' 'Red'; exit 1 }
}

# 3. Is JARVIS already running? Then just open it. Otherwise take a free port, preferring the remembered one.
$sticky = $null
try { if (Test-Path $PortFile) { $sticky = [int](Get-Content $PortFile -TotalCount 1) } } catch {}
$candidates = @(3000..3010)
if ($sticky -ge 3000 -and $sticky -le 3010) { $candidates = @($sticky) + @($candidates | Where-Object { $_ -ne $sticky }) }
$port = $null
foreach ($p in $candidates) {
  if (IsJarvis $p) { Say "  JARVIS is already running - opening it." 'Green'; Start-Process "http://localhost:$p"; exit 0 }
  if (-not (IsBusy $p)) { $port = $p; break }
}
if (-not $port) {
  if ($Silent) { Msg 'JARVIS could not find a free port (3000-3010). Restart your computer and try again.' } else { Say '  Could not find a free port (3000-3010). Restart your computer and try again.' 'Red' }
  exit 1
}
try { Set-Content -Path $PortFile -Value "$port" -Encoding ASCII } catch {}
$env:PORT = "$port"

# 4. Register jarvis://start once, so the web page can start the server itself (the START JARVIS button).
# Done by writing a .reg file and importing it: reg add with an argument full of quotes gets mangled by
# PowerShell 5.1's native-arg quoting (reg loses /f and waits on stdin forever), but a file import is
# atomic and has none of those problems.
try {
  $url = "`"$env:windir\System32\WindowsPowerShell\v1.0\powershell.exe`" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\start.ps1`" -Silent"
  $esc = $url.Replace('\', '\\').Replace('"', '\"')
  $regFile = Join-Path $env:TEMP 'jarvis-protocol.reg'
  Set-Content -Path $regFile -Encoding ASCII -Value @(
    'Windows Registry Editor Version 5.00',
    '',
    '[HKEY_CURRENT_USER\Software\Classes\jarvis]',
    '@="URL:JARVIS"',
    '"URL Protocol"=" "',
    '',
    '[HKEY_CURRENT_USER\Software\Classes\jarvis\shell\open\command]',
    '@="' + $esc + '"'
  )
  $cur = (reg query 'HKCU\Software\Classes\jarvis\shell\open\command' /ve 2>$null | Select-String 'REG_SZ') -replace '^.*REG_SZ\s+', ''
  # NB: piping 'y' matters — reg import asks before overwriting an existing key and would wait on
  # stdin forever when spawned without a console. 'y' + EOF answers it and can never hang.
  if ($cur.Trim() -ne $url) { 'y' | reg import $regFile 2>$null | Out-Null; Say '  The page can now start JARVIS itself (jarvis:// link registered).' 'Green' }
  Remove-Item $regFile -Force -ErrorAction SilentlyContinue
} catch {}

# 5. Desktop shortcut (once; re-points itself at the no-window launcher). Also via wscript //B:
# the WScript.Shell COM object hung in spawned PowerShell on this machine, wscript.exe does not.
try {
  $vbs = Join-Path $PSScriptRoot 'jarvis-silent.vbs'
  if (Test-Path $vbs) { Start-Process wscript.exe -ArgumentList ('//B "' + (Join-Path $PSScriptRoot 'jarvis-shortcut.vbs') + '" "' + $vbs + '"') }
} catch {}

# 6. Friendly hint about the AI (the app itself walks you through it)
if (-not $Silent) {
  $ollama = (Get-Command ollama -ErrorAction SilentlyContinue) -or (Test-Path "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe")
  if (-not $ollama) { Say '  No local AI found - that is fine, JARVIS will guide you to set one up in the browser.' 'DarkGray' }
}

# 7. Start the server. Silent: hidden in the background, remembered by PID, browser opens when ready.
function WaitHealthy($p) { for ($i = 0; $i -lt 90; $i++) { if (IsJarvis $p) { return $true }; Start-Sleep -Milliseconds 700 } return $false }

if ($Silent) {
  if (IsJarvis $port) { Start-Process "http://localhost:$port"; exit 0 } # someone started it meanwhile
  try { New-Item -ItemType Directory -Force -Path $AppData | Out-Null } catch {}
  $node = (Get-Command node).Source
  try { Set-Content -Path $LogFile -Value "[launcher] starting node on port $port at $(Get-Date -Format s)" -Encoding ASCII } catch {}
  $p = $null
  try {
    $p = Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru `
          -RedirectStandardOutput $LogFile -RedirectStandardError ($LogFile + '.err')
  } catch { try { Add-Content -Path $LogFile -Value ("[launcher] could not start node: " + $_.Exception.Message) } catch {} }
  if ($p) { try { Set-Content -Path $PidFile -Value "$($p.Id)" -Encoding ASCII } catch {} }
  if ($p -and (WaitHealthy $port)) { Start-Process "http://127.0.0.1:$port"; exit 0 }
  $why = ''
  try { if (Test-Path ($LogFile + '.err')) { $why = (Get-Content ($LogFile + '.err') -Tail 3) -join ' ' } } catch {}
  if ($p -and $p.HasExited) { $why = "node exited immediately (code $($p.ExitCode)). $why" }
  Msg "JARVIS did not come up. $why The log is in ~/jarvis/.launcher.log - or double-click Start JARVIS to see the details."
  exit 1
}

Say "  Starting JARVIS on http://localhost:$port  (keep this window open; close it to stop JARVIS)" 'Green'
Say ''
node server.js
