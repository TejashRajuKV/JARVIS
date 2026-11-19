param([switch]$Hotkey)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$created = $false
$name = if ($Hotkey) { 'Local\JarvisMarksHotkey' } else { 'Local\JarvisMarksTray' }
$mutex = New-Object System.Threading.Mutex($true, $name, [ref]$created)
if (!$created) { $mutex.Dispose(); exit }

$app = 'http://localhost:3002'
$tray = New-Object System.Windows.Forms.NotifyIcon
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$timer = New-Object System.Windows.Forms.Timer
$shortcut = $null
try {
  try {
    $health = Invoke-RestMethod -Uri "$app/api/health" -TimeoutSec 2
    if ($health.marksEnabled -ne $true) { throw 'Marks is disabled.' }
  } catch {
    [void][System.Windows.Forms.MessageBox]::Show('Open your existing JARVIS instance with Marks enabled, then start the tray launcher again.', 'JARVIS Marks')
    exit 1
  }
  if ($Hotkey) {
    Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public sealed class MarksShortcut : NativeWindow, IDisposable {
  [DllImport("user32.dll")] private static extern bool RegisterHotKey(IntPtr handle, int id, uint flags, uint key);
  [DllImport("user32.dll")] private static extern bool UnregisterHotKey(IntPtr handle, int id);
  public event EventHandler Activated;
  public MarksShortcut() {
    CreateHandle(new CreateParams());
    if (!RegisterHotKey(Handle, 1, 0x4003, 0x4A)) {
      DestroyHandle();
      throw new InvalidOperationException("Ctrl+Alt+J is already taken.");
    }
  }
  protected override void WndProc(ref Message message) {
    if (message.Msg == 0x312 && message.WParam.ToInt32() == 1 && Activated != null) Activated(this, EventArgs.Empty);
    base.WndProc(ref message);
  }
  public void Dispose() {
    if (Handle == IntPtr.Zero) return;
    UnregisterHotKey(Handle, 1);
    DestroyHandle();
  }
}
'@
    try { $shortcut = New-Object MarksShortcut }
    catch {
      [void][System.Windows.Forms.MessageBox]::Show('Cannot register Ctrl+Alt+J. The shortcut may already be in use.', 'JARVIS Marks')
      exit 1
    }
    $edge = @(${env:ProgramFiles(x86)}, $env:ProgramFiles, $env:LOCALAPPDATA) |
      Where-Object { $_ } | ForEach-Object { Join-Path $_ 'Microsoft\Edge\Application\msedge.exe' } |
      Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    $open = {
      if ($edge) {
        Start-Process -FilePath $edge -ArgumentList @("--app=$app/marks.html?entry=hotkey", '--window-size=700,600')
      } else { Start-Process -FilePath "$app/marks.html?entry=hotkey" }
    }
    $shortcut.add_Activated($open)
    $label = 'Open compact commands (Ctrl+Alt+J)'
    $tray.Text = 'JARVIS Marks - Ctrl+Alt+J'
  } else {
    $open = { Start-Process -FilePath "$app/marks.html?entry=offline-tray" }
    $label = 'Open offline workspace'
    $tray.Text = 'JARVIS Marks - Offline Tray'
  }
  $menu.Items.Add($label, $null, $open) | Out-Null
  $menu.Items.Add('Exit', $null, { [System.Windows.Forms.Application]::ExitThread() }) | Out-Null
  $tray.add_DoubleClick($open)
  $tray.ContextMenuStrip = $menu
  $tray.Icon = [System.Drawing.SystemIcons]::Application
  $tray.Visible = $true
  $timer.Interval = 8000
  $timer.add_Tick({
    try {
      $current = Invoke-RestMethod -Uri "$app/api/health" -TimeoutSec 1
      if ($current.marksEnabled -ne $true) { [System.Windows.Forms.Application]::ExitThread() }
    } catch { }
  })
  $timer.Start()
  [System.Windows.Forms.Application]::Run()
} finally {
  $timer.Dispose()
  if ($shortcut) { $shortcut.Dispose() }
  $tray.Visible = $false
  $tray.Dispose()
  $menu.Dispose()
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
