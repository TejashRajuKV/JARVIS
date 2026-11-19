@echo off
start "" powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -STA -ExecutionPolicy Bypass -File "%~dp0marks-tray.ps1" -Hotkey
