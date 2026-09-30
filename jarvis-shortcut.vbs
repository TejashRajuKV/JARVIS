' Creates or updates the desktop JARVIS shortcut (points it at the no-window launcher).
' Args: <full path to jarvis-silent.vbs>. Run via wscript //B so the launcher never waits on COM.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
target = WScript.Arguments(0)
If fso.FileExists(target) Then
  Set s = sh.CreateShortcut(sh.SpecialFolders("Desktop") & "\JARVIS.lnk")
  s.TargetPath = target
  s.WorkingDirectory = fso.GetParentFolderName(target)
  s.WindowStyle = 7
  s.Description = "Start JARVIS"
  s.Save
End If
