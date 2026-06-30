@echo off
cd /d "%~dp0"

echo.
echo Starting LRBridge...
echo.

node bridge.js

echo.
echo LRBridge stopped.
pause