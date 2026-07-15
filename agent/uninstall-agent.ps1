# Removes the GST Keeper agent auto-start task. Files + .env are left in place.
$ErrorActionPreference = 'SilentlyContinue'
$taskName = "GSTKeeperAgent"
Stop-ScheduledTask -TaskName $taskName
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host "GST Keeper agent auto-start removed. Your .env and files are kept." -ForegroundColor Green
Read-Host "Press Enter to close"
