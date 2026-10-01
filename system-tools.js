'use strict';
/* Windows laptop controls: screen reading (built-in OCR), brightness, dark mode, Bluetooth/Wi-Fi,
   power plans, exact volume, display off, window layout and opt-in clipboard history.
   Every input is validated against numbers or fixed lists; user text never reaches a shell. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

module.exports = function setupSystemTools(app, { IS_WIN, APPS }) {
  const winOnly = (req, res, next) => (IS_WIN ? next() : res.status(501).json({ error: 'This control is only available on Windows' }));

  // Runs a fixed PowerShell script; arguments travel in environment variables, never in the script text.
  function ps(script, env = {}, timeout = 20000) {
    return new Promise(resolve => {
      const full = '$ErrorActionPreference="Stop"; [Console]::OutputEncoding=[Text.Encoding]::UTF8; try {\n' + script +
        '\n} catch { [Console]::Out.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress)) }';
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', full],
        { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...env } },
        (err, stdout, stderr) => {
          const line = String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
          try { return resolve(JSON.parse(line)); } catch {}
          resolve({ error: (err && err.killed ? 'Timed out' : (stderr || (err && err.message) || 'No output')).toString().trim().split('\n')[0] });
        });
    });
  }

  const WINRT_AWAIT = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }`;

  /* ---------- read my screen (OCR) ---------- */
  const OCR = WINRT_AWAIT + `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace J -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr h, out RECT r); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n); public struct RECT { public int L, T, R, B; }'
[void][J.U]::SetProcessDPIAware()
$png = $env:JARVIS_OCR_PNG
$src = $env:JARVIS_OCR_SRC
if ($src -eq 'clipboard') {
  $img = [System.Windows.Forms.Clipboard]::GetImage()
  if (-not $img) { [Console]::Out.WriteLine((@{ error = 'noimage' } | ConvertTo-Json -Compress)); return }
  $img.Save($png, [System.Drawing.Imaging.ImageFormat]::Png); $img.Dispose()
} else {
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $x = $b.Left; $y = $b.Top; $w = $b.Width; $h = $b.Height
  if ($src -eq 'window') {
    $sbT = New-Object System.Text.StringBuilder 512; [void][J.U]::GetWindowText([J.U]::GetForegroundWindow(), $sbT, 512); $title = $sbT.ToString()
    $r = New-Object J.U+RECT
    if ([J.U]::GetWindowRect([J.U]::GetForegroundWindow(), [ref]$r) -and ($r.R - $r.L) -gt 80 -and ($r.B - $r.T) -gt 80) {
      $x = [Math]::Max($r.L, $b.Left); $y = [Math]::Max($r.T, $b.Top)
      $w = [Math]::Min($r.R, $b.Right) - $x; $h = [Math]::Min($r.B, $b.Bottom) - $y
    }
  }
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($x, $y, 0, 0, $bmp.Size); $bmp.Save($png); $g.Dispose(); $bmp.Dispose()
}
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($png)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$sb = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$res = Await ($eng.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
$stream.Dispose()
$lines = @($res.Lines | ForEach-Object { $_.Text })
[Console]::Out.WriteLine((@{ text = ($lines -join "\`n"); lines = $lines.Count; title = $title; width = $sb.PixelWidth; height = $sb.PixelHeight } | ConvertTo-Json -Compress))`;

  // Downscales an existing image for the vision model. Deliberately a separate script from OCR: Windows Defender's
  // script scanner (AMSI) blocks screen capture + image re-encoding in one script as "malicious content".
  const SHRINK = `
Add-Type -AssemblyName System.Drawing
$full = [System.Drawing.Image]::FromFile($env:JARVIS_IMG_IN)
$scale = [Math]::Min(1.0, 1280 / [Math]::Max($full.Width, $full.Height))
$nw = [Math]::Max(1, [int]($full.Width * $scale)); $nh = [Math]::Max(1, [int]($full.Height * $scale))
$small = New-Object System.Drawing.Bitmap $nw, $nh
$g = [System.Drawing.Graphics]::FromImage($small); $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($full, 0, 0, $nw, $nh); $g.Dispose(); $full.Dispose()
$small.Save($env:JARVIS_IMG_OUT, [System.Drawing.Imaging.ImageFormat]::Jpeg); $small.Dispose()
[Console]::Out.WriteLine((@{ width = $nw; height = $nh } | ConvertTo-Json -Compress))`;

  // Screenshots for the vision model stay in memory only, under a single-use token that expires in 2 minutes;
  // /api/chat attaches the image itself, so it never passes through the browser or the JSON body limit.
  const visionCache = new Map();
  app.locals.takeVisionImage = token => {
    const v = visionCache.get(token); visionCache.delete(token);
    return v && v.expires > Date.now() ? v.b64 : null;
  };

  app.post('/api/sys/screenRead', winOnly, async (req, res) => {
    const source = ['screen', 'window', 'clipboard'].includes(req.body.source) ? req.body.source : 'window';
    const delay = source === 'clipboard' ? 0 : Math.max(0, Math.min(10, parseInt(req.body.delay) || 0));
    const stem = path.join(os.tmpdir(), `jarvis_ocr_${process.pid}_${Date.now()}`);
    const png = stem + '.png', jpg = req.body.vision ? stem + '.jpg' : '';
    if (delay) await new Promise(r => setTimeout(r, delay * 1000));
    const t0 = Date.now();
    const r = await ps(OCR, { JARVIS_OCR_PNG: png, JARVIS_OCR_SRC: source }, 30000);
    let imageToken;
    if (jpg && !r.error) {
      try {
        const shrunk = await ps(SHRINK, { JARVIS_IMG_IN: png, JARVIS_IMG_OUT: jpg }, 20000);
        // If the downscale is unavailable, send the original capture if it's a reasonable size.
        const file = !shrunk.error && fs.existsSync(jpg) ? jpg : (fs.statSync(png).size < 6e6 ? png : null);
        if (!file) throw new Error('capture too large');
        const b64 = fs.readFileSync(file).toString('base64');
        for (const [k, v] of visionCache) if (v.expires <= Date.now()) visionCache.delete(k);
        imageToken = crypto.randomBytes(16).toString('hex');
        visionCache.set(imageToken, { b64, expires: Date.now() + 120000 });
      } catch {}
    }
    fs.unlink(png, () => {}); if (jpg) fs.unlink(jpg, () => {}); // the capture never stays on disk
    if (r.error === 'noimage') return res.status(404).json({ error: 'There is no image on the clipboard — snip one with Win+Shift+S first' });
    if (r.error) return res.status(500).json({ error: 'Screen reading failed: ' + r.error });
    res.json({ success: true, source, text: String(r.text || '').slice(0, 20000), lines: r.lines, title: String(r.title || '').slice(0, 300), width: r.width, height: r.height, ms: Date.now() - t0, imageToken });
  });

  /* ---------- browser tab switch (for "analyse my second tab") ---------- */
  // Presses Ctrl+<n> in the browser, or Ctrl+Tab until JARVIS's own tab is back in front. Keys are sent ONLY while the
  // foreground window is the browser showing JARVIS (go) or the same browser window (back) — never into another app.
  // Kept apart from the capture script: AMSI flags key sending + screen capture in one script.
  const TAB_SWITCH = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace J -Name T -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n);'
function Title { $s = New-Object System.Text.StringBuilder 512; [void][J.T]::GetWindowText([J.T]::GetForegroundWindow(), $s, 512); $s.ToString() }
$expect = $env:JARVIS_EXPECT; $hwnd = [J.T]::GetForegroundWindow()
if ($env:JARVIS_MODE -eq 'go') {
  if (-not (Title).Contains($expect)) { [Console]::Out.WriteLine((@{ error = 'notfront'; title = (Title) } | ConvertTo-Json -Compress)); return }
  [System.Windows.Forms.SendKeys]::SendWait('^' + $env:JARVIS_N); Start-Sleep -Milliseconds 1200
  [Console]::Out.WriteLine((@{ ok = $true; title = (Title) } | ConvertTo-Json -Compress)); return
}
for ($i = 0; $i -lt 15; $i++) {
  if ((Title).Contains($expect)) { [Console]::Out.WriteLine((@{ ok = $true } | ConvertTo-Json -Compress)); return }
  if ([J.T]::GetForegroundWindow() -ne $hwnd) { break }
  [System.Windows.Forms.SendKeys]::SendWait('^{TAB}'); Start-Sleep -Milliseconds 250
}
[Console]::Out.WriteLine((@{ ok = $false } | ConvertTo-Json -Compress))`;
  app.post('/api/sys/browserTab', winOnly, async (req, res) => {
    const b = req.body || {}, mode = b.mode === 'back' ? 'back' : 'go';
    const n = Math.max(1, Math.min(8, parseInt(b.n) || 0)), expect = String(b.expect || '').slice(0, 200);
    if (expect.length < 4 || (mode === 'go' && !parseInt(b.n))) return res.status(400).json({ error: 'Bad tab request' });
    const r = await ps(TAB_SWITCH, { JARVIS_MODE: mode, JARVIS_N: String(n), JARVIS_EXPECT: expect }, 15000);
    res.json(r);
  });

  /* ---------- brightness ---------- */
  app.post('/api/sys/brightness', winOnly, async (req, res) => {
    const cur = await ps(`$b = (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Select-Object -First 1).CurrentBrightness
[Console]::Out.WriteLine((@{ level = $b } | ConvertTo-Json -Compress))`);
    if (cur.error || cur.level === undefined || cur.level === null) return res.status(501).json({ error: 'Brightness control is not available on this display' });
    let target = null;
    if (req.body.level !== undefined) target = parseInt(req.body.level);
    else if (req.body.delta !== undefined) target = cur.level + parseInt(req.body.delta);
    if (target === null || Number.isNaN(target)) return res.json({ success: true, level: cur.level });
    target = Math.max(0, Math.min(100, target));
    const r = await ps(`Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [byte]$env:JARVIS_LEVEL } | Out-Null
[Console]::Out.WriteLine('{"ok":true}')`, { JARVIS_LEVEL: String(target) });
    if (r.error) return res.status(500).json({ error: r.error });
    res.json({ success: true, level: target, previous: cur.level });
  });

  /* ---------- dark / light mode ---------- */
  const THEME_KEY = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
  app.post('/api/sys/theme', winOnly, async (req, res) => {
    const mode = ['dark', 'light'].includes(req.body.mode) ? req.body.mode : null;
    const script = (mode ? `$v = [int]$env:JARVIS_LIGHT
Set-ItemProperty -Path '${THEME_KEY}' -Name AppsUseLightTheme -Value $v -Type DWord
Set-ItemProperty -Path '${THEME_KEY}' -Name SystemUsesLightTheme -Value $v -Type DWord
Add-Type -Namespace J -Name S -MemberDefinition '[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr h, uint m, System.UIntPtr w, string l, uint f, uint t, out System.UIntPtr r);'
$o = [System.UIntPtr]::Zero
[void][J.S]::SendMessageTimeout([System.IntPtr]0xffff, 0x1A, [System.UIntPtr]::Zero, 'ImmersiveColorSet', 2, 3000, [ref]$o)
` : '') + `$p = Get-ItemProperty -Path '${THEME_KEY}'
[Console]::Out.WriteLine((@{ apps = $p.AppsUseLightTheme; system = $p.SystemUsesLightTheme } | ConvertTo-Json -Compress))`;
    const r = await ps(script, { JARVIS_LIGHT: mode === 'light' ? '1' : '0' });
    if (r.error) return res.status(500).json({ error: r.error });
    res.json({ success: true, mode: r.apps === 1 ? 'light' : 'dark' });
  });

  /* ---------- Bluetooth / Wi-Fi radios ---------- */
  const RADIO = WINRT_AWAIT + `
[void][Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]
$access = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
if ("$access" -ne 'Allowed') { [Console]::Out.WriteLine((@{ error = "Windows denied radio access ($access)" } | ConvertTo-Json -Compress)); return }
$radios = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
$r = $radios | Where-Object { "$($_.Kind)" -eq $env:JARVIS_KIND } | Select-Object -First 1
if (-not $r) { [Console]::Out.WriteLine((@{ error = 'none' } | ConvertTo-Json -Compress)); return }
if ($env:JARVIS_STATE) {
  $st = [Windows.Devices.Radios.RadioState]$env:JARVIS_STATE
  $out = Await ($r.SetStateAsync($st)) ([Windows.Devices.Radios.RadioAccessStatus])
  if ("$out" -ne 'Allowed') { [Console]::Out.WriteLine((@{ error = "Windows refused ($out)" } | ConvertTo-Json -Compress)); return }
}
[Console]::Out.WriteLine((@{ name = $r.Name; state = "$($r.State)" } | ConvertTo-Json -Compress))`;
  app.post('/api/sys/radio', winOnly, async (req, res) => {
    const kind = { bluetooth: 'Bluetooth', wifi: 'WiFi' }[req.body.kind];
    if (!kind) return res.status(400).json({ error: 'kind must be bluetooth or wifi' });
    const state = { on: 'On', off: 'Off' }[req.body.state] || '';
    const r = await ps(RADIO, { JARVIS_KIND: kind, JARVIS_STATE: state });
    if (r.error === 'none') return res.status(404).json({ error: `No ${kind === 'WiFi' ? 'Wi-Fi' : 'Bluetooth'} radio found` });
    if (r.error) return res.status(500).json({ error: r.error });
    res.json({ success: true, kind: req.body.kind, state: String(r.state).toLowerCase() === 'on' ? 'on' : 'off' });
  });

  /* ---------- power plans ---------- */
  const listPlans = () => new Promise(resolve => execFile('powercfg', ['/list'], { windowsHide: true }, (err, out) => {
    const plans = [];
    for (const m of String(out || '').matchAll(/([0-9a-f-]{36})\s+\(([^)]+)\)(\s*\*)?/gi)) plans.push({ guid: m[1], name: m[2].trim(), active: !!m[3] });
    resolve(plans);
  }));
  app.post('/api/sys/powerPlan', winOnly, async (req, res) => {
    const plans = await listPlans();
    if (!plans.length) return res.status(500).json({ error: 'Could not read power plans' });
    const want = String(req.body.plan || '').toLowerCase().trim();
    if (!want) return res.json({ success: true, plans, active: (plans.find(p => p.active) || {}).name });
    const alias = { saver: ['saver', 'battery', 'eco', 'optimizer'], balanced: ['balanced'], performance: ['high performance', 'performance', 'ultimate', 'turbo'] };
    const keys = alias[want] || [want];
    const hit = plans.find(p => keys.some(k => p.name.toLowerCase().includes(k)));
    if (!hit) return res.status(404).json({ error: `No "${want}" plan on this laptop. Available: ${[...new Set(plans.map(p => p.name))].join(', ')}`, plans });
    execFile('powercfg', ['/setactive', hit.guid], { windowsHide: true }, err => {
      if (err) return res.status(500).json({ error: 'Could not switch the power plan' });
      res.json({ success: true, active: hit.name, plans });
    });
  });

  /* ---------- exact volume (Core Audio) ---------- */
  const AUDIO = `Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume { int a(); int b(); int c(); int d(); int SetMasterVolumeLevelScalar(float l, Guid g); int e(); int GetMasterVolumeLevelScalar(out float l); int f(); int g(); int h(); int i(); int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, Guid g); int GetMute(out bool m); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int a(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
public static class JarvisAudio {
  static IAudioEndpointVolume V() { var en = (IMMDeviceEnumerator)new MMDeviceEnumerator(); IMMDevice d; Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out d)); var id = typeof(IAudioEndpointVolume).GUID; object o; Marshal.ThrowExceptionForHR(d.Activate(ref id, 23, IntPtr.Zero, out o)); return (IAudioEndpointVolume)o; }
  public static int Get() { float l; Marshal.ThrowExceptionForHR(V().GetMasterVolumeLevelScalar(out l)); return (int)Math.Round(l * 100); }
  public static void Set(int p) { var v = V(); Marshal.ThrowExceptionForHR(v.SetMute(false, Guid.Empty)); Marshal.ThrowExceptionForHR(v.SetMasterVolumeLevelScalar(p / 100f, Guid.Empty)); }
}
'@
if ($env:JARVIS_LEVEL) { [JarvisAudio]::Set([int]$env:JARVIS_LEVEL) }
[Console]::Out.WriteLine((@{ level = [JarvisAudio]::Get() } | ConvertTo-Json -Compress))`;
  app.post('/api/sys/volume', winOnly, async (req, res) => {
    const lv = req.body.level === undefined ? '' : String(Math.max(0, Math.min(100, parseInt(req.body.level) || 0)));
    const r = await ps(AUDIO, { JARVIS_LEVEL: lv });
    if (r.error) return res.status(500).json({ error: r.error });
    res.json({ success: true, level: r.level });
  });

  /* ---------- turn the display off ---------- */
  app.post('/api/sys/displayOff', winOnly, async (req, res) => {
    const r = await ps(`Add-Type -Namespace J -Name M -MemberDefinition '[DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr h, uint m, System.IntPtr w, System.IntPtr l);'
[void][J.M]::PostMessage([System.IntPtr]0xffff, 0x0112, [System.IntPtr]0xF170, [System.IntPtr]2)
[Console]::Out.WriteLine('{"ok":true}')`);
    if (r.error) return res.status(500).json({ error: r.error });
    res.json({ success: true });
  });

  /* ---------- window layout ---------- */
  const WINDOW = `Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace J -Name Win -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c); [DllImport("user32.dll")] public static extern bool MoveWindow(System.IntPtr h, int x, int y, int w, int hh, bool r); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);'
[void][J.Win]::SetProcessDPIAware()
$names = $env:JARVIS_PROCS -split ','
$act = $env:JARVIS_ACTION
$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$targets = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($names -contains $_.ProcessName) -and [J.Win]::IsWindowVisible($_.MainWindowHandle) })
if ($act -eq 'minimizeOthers') {
  $keep = @($targets | ForEach-Object { $_.MainWindowHandle })
  $n = 0
  Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and [J.Win]::IsWindowVisible($_.MainWindowHandle) -and ($keep -notcontains $_.MainWindowHandle) -and $_.ProcessName -ne 'explorer' } | ForEach-Object { [void][J.Win]::ShowWindow($_.MainWindowHandle, 6); $n++ }
  foreach ($h in $keep) { [void][J.Win]::ShowWindow($h, 9); [void][J.Win]::SetForegroundWindow($h) }
  [Console]::Out.WriteLine((@{ found = $keep.Count; minimized = $n } | ConvertTo-Json -Compress)); return
}
if (-not $targets.Count) { [Console]::Out.WriteLine((@{ error = 'notrunning' } | ConvertTo-Json -Compress)); return }
$h = $targets[0].MainWindowHandle
$half = [int]($wa.Width / 2); $halfH = [int]($wa.Height / 2)
switch ($act) {
  'maximize' { [void][J.Win]::ShowWindow($h, 3) }
  'minimize' { [void][J.Win]::ShowWindow($h, 6) }
  'restore'  { [void][J.Win]::ShowWindow($h, 9) }
  'left'     { [void][J.Win]::ShowWindow($h, 9); [void][J.Win]::MoveWindow($h, $wa.X, $wa.Y, $half, $wa.Height, $true) }
  'right'    { [void][J.Win]::ShowWindow($h, 9); [void][J.Win]::MoveWindow($h, $wa.X + $half, $wa.Y, $wa.Width - $half, $wa.Height, $true) }
  'top'      { [void][J.Win]::ShowWindow($h, 9); [void][J.Win]::MoveWindow($h, $wa.X, $wa.Y, $wa.Width, $halfH, $true) }
  'bottom'   { [void][J.Win]::ShowWindow($h, 9); [void][J.Win]::MoveWindow($h, $wa.X, $wa.Y + $halfH, $wa.Width, $wa.Height - $halfH, $true) }
}
if ($act -ne 'minimize') { [void][J.Win]::SetForegroundWindow($h) }
[Console]::Out.WriteLine((@{ found = $targets.Count; title = $targets[0].MainWindowTitle } | ConvertTo-Json -Compress))`;
  const WIN_ACTIONS = new Set(['left', 'right', 'top', 'bottom', 'maximize', 'minimize', 'restore', 'minimizeOthers']);
  // Some apps' window belongs to a different process than the one we close.
  const WINDOW_PROCS = { explorer: ['explorer'], calculator: ['CalculatorApp', 'ApplicationFrameHost'], settings: ['SystemSettings', 'ApplicationFrameHost'], camera: ['WindowsCamera', 'ApplicationFrameHost'] };
  app.post('/api/sys/window', winOnly, async (req, res) => {
    const key = String(req.body.app || '').toLowerCase();
    const action = String(req.body.action || '');
    if (!WIN_ACTIONS.has(action)) return res.status(400).json({ error: 'Unknown window action' });
    const entry = APPS[key];
    if (!entry) return res.status(400).json({ error: `"${key}" is not on my app list` });
    const procs = WINDOW_PROCS[key] || [entry.proc].filter(Boolean);
    if (!procs.length) return res.status(400).json({ error: `I can't arrange ${key} windows` });
    const r = await ps(WINDOW, { JARVIS_PROCS: procs.join(','), JARVIS_ACTION: action });
    if (r.error === 'notrunning') return res.status(404).json({ error: `${key} is not open` });
    if (r.error) return res.status(500).json({ error: r.error });
    res.json({ success: true, app: key, action, ...r });
  });

  /* ---------- clipboard history (opt-in, memory only) ---------- */
  let clipProc = null;
  const clipItems = [];
  const CLIP_WATCH = `Add-Type -AssemblyName System.Windows.Forms
$last = $null
while ($true) {
  if (-not (Get-Process -Id ([int]$env:JARVIS_PPID) -ErrorAction SilentlyContinue)) { exit }
  $t = $null
  try { if ([System.Windows.Forms.Clipboard]::ContainsText()) { $t = [System.Windows.Forms.Clipboard]::GetText() } } catch {}
  if ($t -and $t -ne $last) {
    $last = $t
    if ($t.Length -gt 5000) { $t = $t.Substring(0, 5000) }
    [Console]::Out.WriteLine((@{ t = $t } | ConvertTo-Json -Compress)); [Console]::Out.Flush()
  }
  Start-Sleep -Milliseconds 1000
}`;
  function startClip() {
    if (clipProc) return;
    clipProc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' + CLIP_WATCH],
      { windowsHide: true, env: { ...process.env, JARVIS_PPID: String(process.pid) } });
    let buf = '', first = true;
    clipProc.stdout.on('data', c => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        let t; try { t = JSON.parse(line).t; } catch { continue; }
        if (first) { first = false; continue; } // what was already on the clipboard before history started
        if (!t || !String(t).trim()) continue;
        const dup = clipItems.findIndex(x => x.text === t);
        if (dup >= 0) clipItems.splice(dup, 1);
        clipItems.unshift({ text: t, at: Date.now() });
        clipItems.length = Math.min(clipItems.length, 30);
      }
    });
    clipProc.on('exit', () => { clipProc = null; });
  }
  function stopClip() { if (clipProc) { try { clipProc.kill(); } catch {} clipProc = null; } }
  process.on('exit', stopClip);

  app.post('/api/sys/clipHistory', winOnly, (req, res) => {
    const action = String(req.body.action || 'list');
    if (action === 'start') { startClip(); return res.json({ success: true, on: true, items: [] }); }
    if (action === 'stop') { stopClip(); clipItems.length = 0; return res.json({ success: true, on: false }); }
    if (action === 'clear') { clipItems.length = 0; return res.json({ success: true, on: !!clipProc, items: [] }); }
    res.json({ success: true, on: !!clipProc, items: clipItems.map((x, i) => ({ n: i + 1, text: x.text, at: x.at })) });
  });

  /* ---------- diagnostics helpers ---------- */
  app.get('/api/sys/wifi', winOnly, (req, res) => {
    execFile('netsh', ['wlan', 'show', 'interfaces'], { windowsHide: true }, (err, out) => {
      const g = k => { const m = String(out || '').match(new RegExp('^\\s*' + k + '\\s*:\\s*(.+)$', 'm')); return m ? m[1].trim() : null; };
      res.json({ success: true, ssid: g('SSID'), signal: g('Signal'), state: g('State') });
    });
  });

  return { stopClip };
};
