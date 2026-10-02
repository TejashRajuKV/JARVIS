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

// Wake phrases the Windows recogniser can match. The recogniser reads Latin letters only
// (it can't match native Telugu/Kannada script), so we add romanised forms of the
// Telugu "జార్విస్" (jarvis) and Kannada "ಜಾರ್ವಿಸ್" (jarvis) — they're already pronounced
// the same, so a Telugu/Kannada speaker saying the wake word in English will match.
// (The browser-side Voice.createUtterance + Lang.wakeWords() still matches the native
// scripts when JARVIS is in the foreground.)
function wakePhrases(persona) {
  const names = persona === 'friday' ? ['friday', 'jarvis'] : ['jarvis'];
  // Latin transliterations of the Telugu/Kannada wake words (same pronunciation).
  // Native script: జార్విస్ / ಜಾರ್ವಿಸ್ — both romanise to "jarvis", but Indian-English
  // speakers often say it with a longer first vowel ("jaarvis") or with a 'v'→'w' shift.
  const EXTRA_ROMANISED = ['jaarvis', 'jarwis', 'jarvas', 'jarviz'];
  return names.flatMap(n => [n, 'hey ' + n, 'ok ' + n, 'okay ' + n])
    .concat(EXTRA_ROMANISED.flatMap(w => [w, 'hey ' + w, 'ok ' + w, 'okay ' + w]));
}

function createNativeWake({ isWin, broadcast, run = spawn, now = () => Date.now(), minConf = 0.6 }) {
  let proc = null, want = false, persona = 'jarvis', ready = '', error = '', lastWake = 0, restarts = 0, buf = '';
  // Calibration: keep the last 20 wake confidence readings so the page can
  // suggest a sensitivity preset based on real-world accuracy.
  const confSamples = [];
  const MAX_SAMPLES = 20;
  function recordConf(c) {
    if (typeof c !== 'number' || !isFinite(c)) return;
    confSamples.push(c);
    while (confSamples.length > MAX_SAMPLES) confSamples.shift();
  }
  function calibration() {
    if (confSamples.length < 3) return { samples: confSamples.length, suggestion: null, reason: 'need at least 3 wake events to calibrate — say the wake word a few times' };
    const sorted = [...confSamples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const low = sorted[Math.floor(sorted.length * 0.25)];
    const high = sorted[Math.floor(sorted.length * 0.75)];
    // Suggest the preset whose threshold sits below the user's 25th percentile (so 75%+ of wakes fire).
    // normal=0.6, high=0.52, max=0.45 — pick the lowest threshold the user actually needs.
    let suggestion, reason;
    if (low >= 0.6) { suggestion = 'normal'; reason = 'your quietest wake (' + low.toFixed(2) + ') is well above 0.6 — Normal is plenty'; }
    else if (low >= 0.52) { suggestion = 'high'; reason = 'your quietest wake (' + low.toFixed(2) + ') sits between 0.52 and 0.6 — High hears you better'; }
    else if (low >= 0.45) { suggestion = 'max'; reason = 'your quietest wake (' + low.toFixed(2) + ') needs Max sensitivity'; }
    else { suggestion = 'max'; reason = 'your quietest wake (' + low.toFixed(2) + ') is below 0.45 — Max is required; consider a better microphone'; }
    return { samples: confSamples.length, median: +median.toFixed(2), p25: +low.toFixed(2), p75: +high.toFixed(2), suggestion, reason };
  }
  function onLine(line) {
    let j; try { j = JSON.parse(line); } catch { return; }
    if (j.ready) { ready = j.ready; error = ''; restarts = 0; }
    if (j.error) error = j.error;
    // One "Jarvis" can come out as two results ("hey" + "jarvis"): one event per 2 seconds.
    if (j.wake && now() - lastWake > 2000) { lastWake = now(); recordConf(j.conf); broadcast({ type: 'wake', text: j.wake, conf: j.conf }); }
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
  const status = () => ({ supported: !!isWin, on: want, listening: !!ready, recogniser: ready, error, lastWake, calibration: calibration() });
  return { set, status, stop, calibration, _onLine: onLine, _phrases: wakePhrases, _confSamples: () => [...confSamples] };
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
