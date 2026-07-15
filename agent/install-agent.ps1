# GST Keeper Portal Agent - one-time installer.
#
# Run this ONCE (double-click install-agent.bat). After it finishes, the agent
# runs automatically forever: it starts when Windows starts, restarts itself if
# it ever crashes, and polls the job queue 24/7. Nobody opens a terminal again.
# The only recurring human step is typing a CAPTCHA in the app when a client's
# portal session needs a fresh login.

$ErrorActionPreference = 'Stop'
$agentDir = $PSScriptRoot
Set-Location $agentDir

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  GST Keeper Portal Agent - installer" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

# 1) Node.js must be present (one-time prerequisite).
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js is not installed on this PC." -ForegroundColor Red
  Write-Host "Install the LTS version from https://nodejs.org/ , then double-click this again."
  Read-Host "Press Enter to exit"
  exit 1
}
Write-Host ("Node.js found: " + (node -v))

# 2) .env - created once. Only the Supabase service-role key is needed; the URL
#    is filled in for you.
$envPath = Join-Path $agentDir ".env"
if (-not (Test-Path $envPath)) {
  Write-Host ""
  Write-Host "ONE-TIME SETUP: paste your Supabase SERVICE ROLE key." -ForegroundColor Yellow
  Write-Host "Find it at: Supabase dashboard -> Project Settings -> API -> 'service_role' (secret)."
  Write-Host "(It is only stored locally on this PC, never in the app or git.)"
  $key = Read-Host "Service role key"
  if ([string]::IsNullOrWhiteSpace($key)) {
    Write-Host "No key entered - aborting." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
  }
  $envText = @"
SUPABASE_URL=https://gcquafqxbykxkbexcdpy.supabase.co
SUPABASE_SERVICE_ROLE_KEY=$key
AGENT_ID=office-pc-1
HEADFUL=false
"@
  Set-Content -Path $envPath -Value $envText -Encoding UTF8
  Write-Host ".env created." -ForegroundColor Green
} else {
  Write-Host ".env already exists - keeping your existing settings."
}

# 3) Dependencies + the browser Playwright drives.
Write-Host ""
Write-Host "Installing dependencies (a few minutes the first time)..." -ForegroundColor Cyan
npm install
Write-Host "Downloading the Chromium browser the agent uses..." -ForegroundColor Cyan
npx playwright install chromium

# 4) Register the always-on auto-start task.
$taskName = "GSTKeeperAgent"
$npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npmCmd) { $npmCmd = "npm.cmd" }

$action   = New-ScheduledTaskAction -Execute $npmCmd -Argument "start" -WorkingDirectory $agentDir
$trigger  = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
              -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
              -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable

try {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "GST Keeper portal agent - polls the job queue and runs pulls." | Out-Null
  Write-Host ("Auto-start registered as scheduled task '" + $taskName + "' (runs at logon, restarts on crash).") -ForegroundColor Green
  Start-ScheduledTask -TaskName $taskName
  Write-Host "Agent started." -ForegroundColor Green
} catch {
  Write-Host ("Could not register the auto-start task automatically: " + $_.Exception.Message) -ForegroundColor Yellow
  Write-Host "The agent is installed; start it once with 'npm start' in this folder, or re-run this as Administrator."
}

Write-Host ""
Write-Host "==============================================" -ForegroundColor Green
Write-Host "  DONE - the agent is running and will now" -ForegroundColor Green
Write-Host "  start automatically every time this PC is on." -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Your team just clicks 'Sync from portal' in the app and types a"
Write-Host "CAPTCHA when one pops up. Nothing else to run here."
Write-Host ""
Read-Host "Press Enter to close"
