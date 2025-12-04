# vStats Agent Upgrade Script
# Usage: irm https://vstats.zsoft.cc/agent-upgrade.ps1 | iex

# Check if running as administrator
function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
    Write-Host ""
    Write-Host "⚠️  Administrator privileges required" -ForegroundColor Yellow
    Write-Host "Please run PowerShell as Administrator" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}

# Load main script and execute upgrade
. {iex (irm https://vstats.zsoft.cc/agent.ps1)}
Update-VStatsAgent

