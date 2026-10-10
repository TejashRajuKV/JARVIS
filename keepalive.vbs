' Runs keepalive.ps1 with no window at all (Task Scheduler starts this every 5 minutes when "Keep JARVIS running" is on).
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
q = Chr(34)
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File " & q & here & "\keepalive.ps1" & q, 0, False
