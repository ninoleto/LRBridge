@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install-runtime-presets.ps1"
if errorlevel 1 (
  echo Installation failed. Read the message above; no differing preset was overwritten.
  pause
  exit /b 1
)
pause
