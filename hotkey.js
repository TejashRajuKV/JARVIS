'use strict';
/* Global hotkey (Ctrl+Shift+J): select text in ANY app, press it, and JARVIS gets the selection.
   A small PowerShell helper (STA) registers the hotkey with Windows, waits until you let go of the keys, copies the
   selection with Ctrl+C, puts your previous clipboard text back, and prints one line. Opt-in (Settings), Windows only.
   The helper exits by itself when JARVIS stops. It never reads the clipboard except at the moment you press the hotkey. */
const { spawn } = require('child_process');

const MAX_TEXT = 8000;
// Helper protocol: "READY" once registered, "FAIL" if another program owns the hotkey, "PRESS:<base64 utf8>" per press.
function parseLine(line) {
  const l = String(line || '').trim();
  if (l === 'READY') return { type: 'ready' };
  if (l === 'FAIL') return { type: 'fail' };
  const m = /^PRESS:([A-Za-z0-9+/=]*)$/.exec(l);
  if (!m) return null;
  let text = '';
  try { text = Buffer.from(m[1], 'base64').toString('utf8'); } catch {}
  text = text.replace(/\0/g, '').trim();
  return { type: 'press', text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text, truncated: text.length > MAX_TEXT };
}

const HELPER = `Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace J -Name HK -MemberDefinition '
[DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr h, int id, uint mod, uint vk);
[DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h, int id);
[DllImport("user32.dll")] public static extern bool PeekMessage(out MSG m, IntPtr h, uint a, uint b, uint remove);
[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int k);
[StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
'
function Say($s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }
if (-not [J.HK]::RegisterHotKey([IntPtr]::Zero, 1, 0x4006, 0x4A)) { Say 'FAIL'; exit }
Say 'READY'
$m = New-Object 'J.HK+MSG'
while ($true) {
  if (-not (Get-Process -Id ([int]$env:JARVIS_PPID) -ErrorAction SilentlyContinue)) { break }
  if ([J.HK]::PeekMessage([ref]$m, [IntPtr]::Zero, 0x0312, 0x0312, 1)) {
    for ($i = 0; $i -lt 40; $i++) {
      $down = [J.HK]::GetAsyncKeyState(0x11) -bor [J.HK]::GetAsyncKeyState(0x10) -bor [J.HK]::GetAsyncKeyState(0x4A)
      if ($down -band 0x8000) { Start-Sleep -Milliseconds 50 } else { break }
    }
    $old = $null
    try { if ([System.Windows.Forms.Clipboard]::ContainsText()) { $old = [System.Windows.Forms.Clipboard]::GetText() } } catch {}
    $mark = 'JARVIS-' + [guid]::NewGuid().ToString()
    try { [System.Windows.Forms.Clipboard]::SetText($mark) } catch {}
    [System.Windows.Forms.SendKeys]::SendWait('^c')
    Start-Sleep -Milliseconds 200
    $t = $null
    try { $t = [System.Windows.Forms.Clipboard]::GetText() } catch {}
    if ($old -ne $null) { try { [System.Windows.Forms.Clipboard]::SetText($old) } catch {} } else { try { [System.Windows.Forms.Clipboard]::Clear() } catch {} }
    if (-not $t -or $t -eq $mark) { $t = '' }
    Say ('PRESS:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t)))
  } else { Start-Sleep -Milliseconds 60 }
}
[J.HK]::UnregisterHotKey([IntPtr]::Zero, 1) | Out-Null`;

module.exports = function setupHotkey(app, { getState, IS_WIN, PORT }) {
  let proc = null, ready = false, failed = false, stopping = false, retryAt = 0;
  const log = (...a) => console.log('[hotkey]', ...a);
  const wanted = () => IS_WIN && !!(getState()['jarvis.settings'] || {}).hotkey;

  function onPress(p) {
    const ev = { type: 'hotkey', text: p.text, truncated: !!p.truncated };
    const tabs = app.locals.tabCount ? app.locals.tabCount() : 0;
    if (tabs && app.locals.broadcast) app.locals.broadcast(ev);
    else {
      // No JARVIS tab open: hold the selection for 10 minutes and open JARVIS, which picks it up when it connects.
      if (app.locals.hold) app.locals.hold(ev);
      spawn('rundll32', ['url.dll,FileProtocolHandler', `http://localhost:${PORT}/`], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
    }
    log('pressed —', p.text ? p.text.length + ' characters selected' : 'nothing selected', tabs ? '(' + tabs + ' tab(s))' : '(opening JARVIS)');
  }
  function start() {
    if (proc) return;
    ready = false; failed = false; stopping = false;
    proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' + HELPER],
      { windowsHide: true, env: { ...process.env, JARVIS_PPID: String(process.pid) } });
    let buf = '';
    proc.stdout.on('data', c => {
      buf += c; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const ev = parseLine(buf.slice(0, i)); buf = buf.slice(i + 1);
        if (!ev) continue;
        if (ev.type === 'ready') { ready = true; log('Ctrl+Shift+J is active'); }
        else if (ev.type === 'fail') { failed = true; log('Ctrl+Shift+J is already used by another program'); }
        else if (ev.type === 'press') onPress(ev);
      }
    });
    proc.stderr.on('data', c => { if (!stopping) log('helper error:', String(c).split('\n')[0].slice(0, 160)); });
    proc.on('exit', () => { proc = null; ready = false; if (!stopping && !failed) retryAt = Date.now() + 30000; });
    proc.on('error', e => { proc = null; ready = false; failed = true; log('could not start:', e.message); });
  }
  function stop() { if (!proc) return; stopping = true; try { proc.kill(); } catch {} proc = null; ready = false; }
  // Follows the Settings switch (the page saves it to the shared state).
  setInterval(() => { if (wanted()) { if (!proc && !failed && Date.now() >= retryAt) start(); } else { failed = false; stop(); } }, 4000);
  process.on('exit', stop);

  app.get('/api/hotkey/status', (req, res) => res.json({ success: true, supported: IS_WIN, enabled: wanted(), running: !!proc && ready, taken: failed }));
};
Object.assign(module.exports, { parseLine, HELPER, MAX_TEXT });
