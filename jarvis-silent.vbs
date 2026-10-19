' Starts JARVIS with no windows at all: runs the launcher silently in the background.
' The desktop "JARVIS" shortcut and the Startup link point here (start.ps1 re-points them automatically).
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
q = Chr(34)
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File " & q & here & "\start.ps1" & q & " -Silent", 0, False
