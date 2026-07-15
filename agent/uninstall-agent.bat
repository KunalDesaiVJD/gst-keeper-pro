@echo off
REM Stops and removes the GST Keeper agent auto-start (double-click this file).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-agent.ps1"
