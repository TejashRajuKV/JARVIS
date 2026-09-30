'use strict';
/* Wake word that works while you're in another tab or app (Windows).
   Browsers must stop speech recognition when their page loses focus (Web Speech spec), so the page alone can only
   hear "Jarvis" while it's in front. This runs Windows' own offline speech recogniser (System.Speech — nothing leaves
   the laptop) listening ONLY for the wake word, next to a catch-all "anything else" grammar so ordinary speech isn't
   forced into a match. On a hit it tells the page (event "wake"); the page, if it's in the background, asks
   /api/wake/front to bring the JARVIS window forward and then takes the command with the browser recogniser as usual
   (English, Telugu, Kannada). Runs only while the wake word is switched on. */
const { spawn } = require('child_process');

// Long-lived listener. Prints one JSON line per event: {ready}, {wake, conf}, {error}.
const LISTEN = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
  $rec = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -like 'en-*' } | Select-Object -First 1
  if (-not $rec) { [Console]::Out.WriteLine('{"error":"no English speech recogniser is installed (Windows Settings > Time & language > Speech)"}'); exit 1 }
  $e = New-Object System.Speech.Recognition.SpeechRecognitionEngine $rec
  $words = New-Object System.Speech.Recognition.Choices
  foreach ($w in ($env:JARVIS_WAKE -split ',')) { if ($w.Trim()) { $words.Add($w.Trim()) } }
  $wake = New-Object System.Speech.Recognition.Grammar (New-Object System.Speech.Recognition.GrammarBuilder $words)
  $wake.Name = 'wake'
  $gb = New-Object System.Speech.Recognition.GrammarBuilder; $gb.AppendWildcard()
  $other = New-Object System.Speech.Recognition.Grammar $gb
  $other.Name = 'other'
  $e.LoadGrammar($wake); $e.LoadGrammar($other)
  $e.SetInputToDefaultAudioDevice()
  [Console]::Out.WriteLine('{"ready":"' + $rec.Culture.Name + '"}'); [Console]::Out.Flush()
  $min = [double]$env:JARVIS_MINCONF
  while ($true) {
    $r = $e.Recognize([TimeSpan]::FromSeconds(10))
    if ($r -and $r.Grammar.Name -eq 'wake' -and $r.Confidence -ge $min) {
      [Console]::Out.WriteLine('{"wake":"' + $r.Text + '","conf":' + [Math]::Round($r.Confidence, 2) + '}'); [Console]::Out.Flush()
    }
  }
} catch { [Console]::Out.WriteLine('{"error":"' + ($_.Exception.Message -replace '["\\\\]', ' ') + '"}') }
`;

// Brings the JARVIS window (the installed app window, or a browser window whose active tab is JARVIS) to the front.
// A single Alt tap first is the documented way to let a program move another window to the foreground.
const FRONT = `
Add-Type -Namespace J -Name W -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c); [DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h); [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, System.UIntPtr e);'
$w = Get-Process msedge, chrome, brave, firefox -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match 'JARVIS' } | Select-Object -First 1
if (-not $w) { [Console]::Out.WriteLine('none'); exit }
$h = $w.MainWindowHandle
if ([J.W]::IsIconic($h)) { [void][J.W]::ShowWindow($h, 9) }
[J.W]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [J.W]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
[void][J.W]::SetForegroundWindow($h)
[Console]::Out.WriteLine('front')`;

// English wake phrases the Windows recogniser can match (it can't read Telugu/Kannada script).
function wakePhrases(persona) {
  const names = persona === 'friday' ? ['friday', 'jarvis'] : ['jarvis'];
  return names.flatMap(n => [n, 'hey ' + n, 'ok ' + n, 'okay ' + n]);
}

function createNativeWake({ isWin, broadcast, run = spawn, now = () => Date.now(), minConf = 0.6 }) {
  let proc = null, want = false, persona = 'jarvis', ready = '', error = '', lastWake = 0, restarts = 0, buf = '';
  function onLine(line) {
    let j; try { j = JSON.parse(line); } catch { return; }
    if (j.ready) { ready = j.ready; error = ''; restarts = 0; }
    if (j.error) error = j.error;
    // One "Jarvis" can come out as two results ("hey" + "jarvis"): one event per 2 seconds.
    if (j.wake && now() - lastWake > 2000) { lastWake = now(); broadcast({ type: 'wake', text: j.wake, conf: j.conf }); }
  }
  function start() {
    if (proc || !isWin) return;
    buf = '';
    proc = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', LISTEN],
      { windowsHide: true, env: Object.assign({}, process.env, { JARVIS_WAKE: wakePhrases(persona).join(','), JARVIS_MINCONF: String(minConf) }) });
    proc.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i).trim()); buf = buf.slice(i + 1); } });
    proc.on('exit', () => {
      proc = null; ready = '';
      // It died while still wanted (mic unplugged, audio device changed): try again, backing off; give up after 5.
      if (want && restarts < 5) { restarts++; setTimeout(() => want && start(), Math.min(30000, 2000 * restarts)); }
    });
  }
  function stop() { want = false; if (proc) { try { proc.kill(); } catch {} proc = null; } ready = ''; }
  function set(on, opts = {}) {
    // Mic sensitivity: from farther away Windows is less sure it heard "Jarvis", so High/Max accept a lower
    // confidence. The catch-all "anything else" grammar still keeps ordinary speech from matching.
    const conf = { normal: 0.6, high: 0.52, max: 0.45 }[opts.sensitivity];
    const changed = (opts.persona && opts.persona !== persona) || (conf && conf !== minConf);
    if (opts.persona) persona = opts.persona;
    if (conf) minConf = conf;
    if (changed && proc) { const w = want; stop(); want = w; }
    if (on) { want = true; restarts = 0; start(); } else stop();
    return status();
  }
  const status = () => ({ supported: !!isWin, on: want, listening: !!ready, recogniser: ready, error, lastWake });
  return { set, status, stop, _onLine: onLine, _phrases: wakePhrases };
}

module.exports = function setupNativeWake(app, { IS_WIN }) {
  const native = createNativeWake({ isWin: !!IS_WIN, broadcast: ev => app.locals.broadcast && app.locals.broadcast(ev) });
  process.on('exit', () => native.stop());
  app.get('/api/wake/native', (req, res) => res.json(native.status()));
  app.post('/api/wake/native', (req, res) => {
    const persona = req.body && req.body.persona === 'friday' ? 'friday' : 'jarvis';
    const sensitivity = ['normal', 'high', 'max'].includes(req.body && req.body.sensitivity) ? req.body.sensitivity : undefined;
    res.json(native.set(!!(req.body && req.body.on), { persona, sensitivity }));
  });
  // The page heard a background wake event: bring the JARVIS window forward so it can take the command.
  app.post('/api/wake/front', (req, res) => {
    if (!IS_WIN) return res.json({ result: 'unsupported' });
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', FRONT], { windowsHide: true });
    let out = ''; p.stdout.on('data', d => { out += d; });
    const t = setTimeout(() => { try { p.kill(); } catch {} }, 8000);
    p.on('close', () => { clearTimeout(t); res.json({ result: out.trim() || 'failed' }); });
  });
  return native;
};
module.exports.createNativeWake = createNativeWake;
module.exports.wakePhrases = wakePhrases;
