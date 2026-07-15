@echo off
REM GST Keeper Portal Agent - one-time installer (double-click this file).
REM It runs the PowerShell installer, which sets up the agent to run
REM automatically forever. You only do this once.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-agent.ps1"
