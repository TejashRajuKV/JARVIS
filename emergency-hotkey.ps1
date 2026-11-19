$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -Namespace JarvisSafety -Name Hotkey -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint key);
[DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hwnd, int id);
[DllImport("user32.dll")] public static extern bool PeekMessage(out MSG msg, IntPtr hwnd, uint min, uint max, uint remove);
[StructLayout(LayoutKind.Sequential)] public struct MSG {
  public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam;
  public uint time; public int x; public int y; public uint privateData;
}
'@
function Say($value) { [Console]::Out.WriteLine($value); [Console]::Out.Flush() }
if (![JarvisSafety.Hotkey]::RegisterHotKey([IntPtr]::Zero, 1, 0x4003, 0x13)) { Say 'TAKEN'; exit 1 }
try {
  Say 'READY'
  $message = New-Object 'JarvisSafety.Hotkey+MSG'
  while (Get-Process -Id ([int]$env:JARVIS_SAFETY_PARENT) -ErrorAction SilentlyContinue) {
    if ([JarvisSafety.Hotkey]::PeekMessage([ref]$message, [IntPtr]::Zero, 0x0312, 0x0312, 1)) {
      Say 'STOP'
    }
    Start-Sleep -Milliseconds 30
  }
} finally { [void][JarvisSafety.Hotkey]::UnregisterHotKey([IntPtr]::Zero, 1) }
