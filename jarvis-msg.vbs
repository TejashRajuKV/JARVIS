' Shows a JARVIS message box and closes itself after 60 seconds (fire-and-forget from start.ps1).
' Args: <title> <text>
Set sh = CreateObject("WScript.Shell")
t = "JARVIS": If WScript.Arguments.Count > 0 Then t = WScript.Arguments(0)
m = "": If WScript.Arguments.Count > 1 Then m = WScript.Arguments(1)
sh.Popup m, 60, t, 64
