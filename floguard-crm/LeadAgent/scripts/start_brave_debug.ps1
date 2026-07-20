# Launch Brave with remote debugging for LeadAgent (dedicated profile).
# Log into LinkedIn / webmail once in this window — agent reuses the session.

$ErrorActionPreference = "Stop"
$port = 9222
$userData = Join-Path $env:LOCALAPPDATA "LeadAgent\BraveProfile"
$braveCandidates = @(
    "${env:ProgramFiles}\BraveSoftware\Brave-Browser\Application\brave.exe",
    "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe",
    "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"
)

$brave = $braveCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $brave) {
    Write-Error "Brave not found. Install Brave or edit this script with the full path."
}

New-Item -ItemType Directory -Force -Path $userData | Out-Null
Write-Host "Profile: $userData"
Write-Host "CDP:     http://127.0.0.1:$port"
Write-Host "Starting Brave..."

Start-Process -FilePath $brave -ArgumentList @(
    "--remote-debugging-port=$port",
    "--user-data-dir=$userData",
    "about:blank"
)

Write-Host "Done. Run: leadagent browser-doctor"
Write-Host "Tip: copy cookies/login by signing into LinkedIn in this window only."
