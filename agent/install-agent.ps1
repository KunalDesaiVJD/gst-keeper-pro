# GST Keeper portal agent - one-time installer for the office PC.
#
# Double-click install-agent.bat once. It writes agent\.env, installs what the
# agent needs, and registers a scheduled task that starts the agent when you
# sign in to Windows and restarts it if it stops. The agent then waits: nothing
# reaches the GST portal until a manager switches the autopilot on in GST Keeper
# (Notices -> Autopilot -> Settings), and every portal login waits for a person
# to type its CAPTCHA on the CAPTCHA wall. See README.md.
#
# The agent needs no secret key: it uses the app's own publishable key from
# ..\extension\config.js. Keep this folder next to the extension folder (the
# repository as it is).

$ErrorActionPreference = 'Stop'
$agentDir = $PSScriptRoot
Set-Location $agentDir

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  GST Keeper portal agent - installer" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

# 1) Node.js 20.16 or later (the PDF reader needs it).
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js is not installed on this PC." -ForegroundColor Red
  Write-Host "Install the LTS version from https://nodejs.org/ , then double-click this again."
  Read-Host "Press Enter to exit"
  exit 1
}
$nodeParts = (node -v).TrimStart('v').Split('.')
$nodeMajor = [int]$nodeParts[0]
$nodeMinor = [int]$nodeParts[1]
if ($nodeMajor -lt 20 -or ($nodeMajor -eq 20 -and $nodeMinor -lt 16)) {
  Write-Host ("Node.js " + (node -v) + " is too old; install the current LTS from https://nodejs.org/ .") -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}
Write-Host ("Node.js found: " + (node -v))

if (-not (Test-Path (Join-Path $agentDir "..\extension\manifest.json"))) {
  Write-Host "The extension folder is missing next to this folder (..\extension). Copy the whole repository to this PC." -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}

# 2) .env - written once, no secrets typed. A random key encrypts portal
#    sessions if the firm later turns on "Keep portal sessions".
$envPath = Join-Path $agentDir ".env"
if (-not (Test-Path $envPath)) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $sessionKey = -join ($bytes | ForEach-Object { $_.ToString("x2") })
  $agentId = "office-" + ($env:COMPUTERNAME.ToLower() -replace '[^a-z0-9-]', '')
  $envText = @"
# GST Keeper portal agent settings (see .env.example for every option).
AGENT_ID=$agentId
HEADFUL=true
AGENT_SESSION_KEY=$sessionKey
# Portal e-mail inbox (optional; see src\mail\README.md):
# IMAP_HOST=imap.gmail.com
# IMAP_USER=notices@yourfirm.com
# IMAP_PASSWORD=app-password
# Reading notices with the Claude API (optional; see README.md, "Reading notices"):
# ANTHROPIC_API_KEY=
"@
  Set-Content -Path $envPath -Value $envText -Encoding UTF8
  Write-Host (".env created (agent id " + $agentId + ").") -ForegroundColor Green
} else {
  Write-Host ".env already exists - keeping your settings."
}

# 3) Dependencies and the Chromium the agent drives.
Write-Host ""
Write-Host "Installing dependencies (a few minutes the first time)..." -ForegroundColor Cyan
npm install --no-audit --no-fund
Write-Host "Downloading the Chromium browser the agent uses..." -ForegroundColor Cyan
npx playwright install chromium

# 4) Start at sign-in, restart if it stops.
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
    -Description "GST Keeper portal agent (Portal Autopilot): fetches portal data; CAPTCHAs are typed by staff in the app." | Out-Null
  Write-Host ("Scheduled task '" + $taskName + "' registered (starts at sign-in, restarts if it stops).") -ForegroundColor Green
  Start-ScheduledTask -TaskName $taskName
  Write-Host "Agent started." -ForegroundColor Green
} catch {
  Write-Host ("Could not register the scheduled task: " + $_.Exception.Message) -ForegroundColor Yellow
  Write-Host "Run this installer as Administrator, or start the agent with 'npm start' in this folder."
}

Write-Host ""
Write-Host "==============================================" -ForegroundColor Green
Write-Host "  DONE. Keep this PC on, signed in and set" -ForegroundColor Green
Write-Host "  never to sleep (Settings -> Power)." -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next, in GST Keeper: Notices -> Autopilot. The page shows this agent online."
Write-Host "A manager switches the autopilot on in its Settings tab; then staff type the"
Write-Host "CAPTCHAs on the CAPTCHA wall tab. Logs: .agent-data\logs on this PC."
Write-Host ""
Read-Host "Press Enter to close"
