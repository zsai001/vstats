<#
.SYNOPSIS
    vStats Agent Installer for Windows
    
.DESCRIPTION
    Downloads and installs the vStats monitoring agent on Windows.
    
.PARAMETER Server
    Dashboard server URL (e.g., http://dashboard:3001)
    
.PARAMETER Token
    Admin authentication token
    
.PARAMETER Name
    Server display name (default: hostname)
    
.PARAMETER Uninstall
    Uninstall the agent
    
.PARAMETER Upgrade
    Upgrade to latest version
    
.EXAMPLE
    # Install agent
    .\agent.ps1 -Server "http://dashboard:3001" -Token "your-token" -Name "Windows-Server-1"
    
    # Or one-line web install:
    . {irm https://vstats.zsoft.cc/agent.ps1}; Install-VStatsAgent -Server "http://dashboard:3001" -Token "your-token"
    
.EXAMPLE
    # Upgrade agent
    .\agent.ps1 -Upgrade
    # Or one-line web upgrade:
    . {irm https://vstats.zsoft.cc/agent.ps1}; Update-VStatsAgent
    
.EXAMPLE
    # Uninstall agent
    .\agent.ps1 -Uninstall
    # Or one-line web uninstall:
    . {irm https://vstats.zsoft.cc/agent.ps1}; Uninstall-VStatsAgent
#>

param(
    [string]$Server,
    [string]$Token,
    [string]$Name = $env:COMPUTERNAME,
    [switch]$Uninstall,
    [switch]$Upgrade,
    [switch]$Help
)

# Helper function to build script arguments
function Build-ScriptArguments {
    $scriptArgs = @()
    if ($Server) { $scriptArgs += "-Server"; $scriptArgs += $Server }
    if ($Token) { $scriptArgs += "-Token"; $scriptArgs += $Token }
    if ($Name -and $Name -ne $env:COMPUTERNAME) { $scriptArgs += "-Name"; $scriptArgs += $Name }
    if ($Uninstall) { $scriptArgs += "-Uninstall" }
    if ($Upgrade) { $scriptArgs += "-Upgrade" }
    if ($Help) { $scriptArgs += "-Help" }
    return $scriptArgs
}

# Check if running as administrator
function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Auto-handle execution policy and admin rights
$scriptPath = $MyInvocation.MyCommand.Path
$isWebInstall = -not $scriptPath

if (-not $isWebInstall) {
    # Check if we need to restart with admin rights
    if (-not (Test-Administrator)) {
        Write-Host ""
        Write-Host "⚠️  Administrator privileges required" -ForegroundColor Yellow
        Write-Host "Requesting administrator access..." -ForegroundColor Cyan
        Write-Host ""
        
        $scriptArgs = Build-ScriptArguments
        # Build argument list properly escaping values
        $argList = @("-ExecutionPolicy", "Bypass", "-NoProfile", "-File", $scriptPath)
        $argList += $scriptArgs
        
        # Restart with admin rights and bypass execution policy
        Start-Process powershell.exe -Verb RunAs -ArgumentList $argList -Wait
        exit $LASTEXITCODE
    }
    
    # Check execution policy if not already bypassed
    if (-not $env:VSTATS_BYPASS_SET) {
        try {
            $policy = Get-ExecutionPolicy -Scope Process -ErrorAction SilentlyContinue
            if ($policy -eq 'Restricted' -or $null -eq $policy) {
                Write-Host ""
                Write-Host "⚠️  Execution policy is Restricted" -ForegroundColor Yellow
                Write-Host "Restarting with Bypass execution policy..." -ForegroundColor Cyan
                Write-Host ""
                
                $scriptArgs = Build-ScriptArguments
                
                # Set flag to prevent infinite loop
                $env:VSTATS_BYPASS_SET = "1"
                
                # Restart with bypass
                & powershell.exe -ExecutionPolicy Bypass -File $scriptPath @scriptArgs
                exit $LASTEXITCODE
            }
        } catch {
            # If we can't check policy, continue anyway
        }
        $env:VSTATS_BYPASS_SET = "1"
    }
} else {
    # For web installs, we can't auto-restart, but we can check admin
    if (-not (Test-Administrator)) {
        Write-Host ""
        Write-Host "⚠️  Administrator privileges required" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Please run PowerShell as Administrator, then run:" -ForegroundColor Cyan
        Write-Host "  . {irm https://vstats.zsoft.cc/agent.ps1}; Install-VStatsAgent -Server ... -Token ..." -ForegroundColor White
        Write-Host ""
        exit 1
    }
    $env:VSTATS_BYPASS_SET = "1"
}

# Configuration
$INSTALL_DIR = "$env:ProgramData\vstats-agent"
$CONFIG_FILE = "$INSTALL_DIR\vstats-agent.json"
$SERVICE_NAME = "vstats-agent"
$GITHUB_REPO = "zsai001/vstats"
$GITHUB_API = "https://api.github.com/repos/$GITHUB_REPO/releases/latest"

# Colors
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) { Write-Output $args }
    $host.UI.RawUI.ForegroundColor = $fc
}

function Info($msg) { Write-Host "[INFO] " -ForegroundColor Blue -NoNewline; Write-Host $msg }
function Success($msg) { Write-Host "[OK] " -ForegroundColor Green -NoNewline; Write-Host $msg }
function Warn($msg) { Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline; Write-Host $msg }
function Error($msg) { Write-Host "[ERROR] " -ForegroundColor Red -NoNewline; Write-Host $msg; exit 1 }

function Show-Banner {
    Write-Host ""
    Write-Host "╔═══════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║        vStats Agent - Monitoring Probe            ║" -ForegroundColor Cyan
    Write-Host "║           Windows PowerShell Installer            ║" -ForegroundColor Cyan
    Write-Host "╚═══════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

function Show-Help {
    Write-Host @"
vStats Agent Installation Script for Windows

Usage: .\agent.ps1 [OPTIONS]

Options:
  -Server URL      Dashboard server URL (required for install)
  -Token TOKEN     Admin authentication token (required for install)
  -Name NAME       Server display name (default: hostname)
  -Uninstall       Uninstall agent
  -Upgrade         Upgrade to latest version
  -Help            Show this help

Examples:
  # Install (if execution policy blocks, use: powershell -ExecutionPolicy Bypass -File agent.ps1 ...)
  .\agent.ps1 -Server "http://dashboard:3001" -Token "your-token" -Name "Windows-Server"
  
  # Upgrade
  .\agent.ps1 -Upgrade
  
  # Uninstall
  .\agent.ps1 -Uninstall

Web Install (PowerShell):
  # One-line install (bypasses execution policy)
  . {irm https://vstats.zsoft.cc/agent.ps1}; Install-VStatsAgent -Server "http://dashboard:3001" -Token "your-token"
  
  # Or download and run with bypass
  irm https://vstats.zsoft.cc/agent.ps1 -OutFile agent.ps1
  powershell -ExecutionPolicy Bypass -File agent.ps1 -Server "http://dashboard:3001" -Token "your-token"
"@
}

function Get-Architecture {
    $arch = [System.Environment]::GetEnvironmentVariable("PROCESSOR_ARCHITECTURE")
    switch ($arch) {
        "AMD64" { return "x86_64" }
        "ARM64" { return "aarch64" }
        default { Error "Unsupported architecture: $arch" }
    }
}

function Get-LatestVersion {
    Info "Fetching latest version..."
    
    try {
        $release = Invoke-RestMethod -Uri $GITHUB_API -ErrorAction Stop
        $version = $release.tag_name
        Success "Latest version: $version"
        return $version
    } catch {
        Warn "Could not fetch latest version, using v1.3.0"
        return "v1.3.0"
    }
}

function Install-Binary {
    param([string]$Version)
    
    $arch = Get-Architecture
    $binaryName = "vstats-agent-windows-$arch.exe"
    $downloadUrl = "https://github.com/$GITHUB_REPO/releases/download/$Version/$binaryName"
    
    Info "Downloading vstats-agent $Version..."
    Info "URL: $downloadUrl"
    
    # Create install directory
    if (-not (Test-Path $INSTALL_DIR)) {
        New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null
    }
    
    $targetPath = "$INSTALL_DIR\vstats-agent.exe"
    
    try {
        # Download with progress
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $downloadUrl -OutFile $targetPath -ErrorAction Stop
        $ProgressPreference = 'Continue'
        
        Success "Binary installed to $targetPath"
    } catch {
        Error "Failed to download binary. Check https://github.com/$GITHUB_REPO/releases"
    }
}

function Register-Agent {
    param(
        [string]$ServerUrl,
        [string]$AuthToken,
        [string]$ServerName
    )
    
    if (-not $ServerUrl -or -not $AuthToken) {
        Error "Dashboard URL and admin token required. Use -Server and -Token parameters."
    }
    
    Info "Registering with dashboard..."
    
    $agentExe = "$INSTALL_DIR\vstats-agent.exe"
    
    $registerArgs = @(
        "register",
        "--server", $ServerUrl,
        "--token", $AuthToken,
        "--name", $ServerName,
        "--config", $CONFIG_FILE
    )
    
    $process = Start-Process -FilePath $agentExe -ArgumentList $registerArgs -Wait -NoNewWindow -PassThru
    
    if ($process.ExitCode -ne 0) {
        Error "Registration failed"
    }
    
    Success "Registered successfully!"
}

function Install-Service {
    Info "Installing Windows service..."
    
    $agentExe = "$INSTALL_DIR\vstats-agent.exe"
    
    # Use the agent's install command
    $installArgs = @("install", "--config", $CONFIG_FILE)
    $process = Start-Process -FilePath $agentExe -ArgumentList $installArgs -Wait -NoNewWindow -PassThru
    
    if ($process.ExitCode -ne 0) {
        # Fallback: create service manually using sc.exe
        Warn "Auto-install failed, creating service manually..."
        
        $binPath = "`"$agentExe`" run --config `"$CONFIG_FILE`""
        
        & sc.exe create $SERVICE_NAME binPath= $binPath DisplayName= "vStats Monitoring Agent" start= auto obj= LocalSystem
        & sc.exe description $SERVICE_NAME "vStats Monitoring Agent - Push system metrics to dashboard"
        & sc.exe failure $SERVICE_NAME reset= 86400 actions= restart/10000/restart/10000/restart/10000
        & sc.exe start $SERVICE_NAME
    }
    
    Success "Service installed and started"
}

function Uninstall-Agent {
    Write-Host "Uninstalling vStats Agent..." -ForegroundColor Yellow
    
    # Stop and delete service
    $service = Get-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
    if ($service) {
        if ($service.Status -eq 'Running') {
            Stop-Service -Name $SERVICE_NAME -Force
            Start-Sleep -Seconds 2
        }
        & sc.exe delete $SERVICE_NAME
    }
    
    # Remove files
    if (Test-Path $INSTALL_DIR) {
        Remove-Item -Path $INSTALL_DIR -Recurse -Force
    }
    
    Success "vStats Agent uninstalled"
    exit 0
}

function Upgrade-Agent {
    Info "Upgrading vStats Agent..."
    
    $version = Get-LatestVersion
    
    # Stop service
    $service = Get-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
    if ($service -and $service.Status -eq 'Running') {
        Stop-Service -Name $SERVICE_NAME -Force
        Start-Sleep -Seconds 2
    }
    
    # Download new binary
    Install-Binary -Version $version
    
    # Start service
    if ($service) {
        Start-Service -Name $SERVICE_NAME
    }
    
    Success "Upgraded to $version"
    exit 0
}

function Show-Complete {
    param([string]$ServerUrl, [string]$ServerName)
    
    # Try to read server ID from config
    $serverId = "N/A"
    if (Test-Path $CONFIG_FILE) {
        try {
            $config = Get-Content $CONFIG_FILE | ConvertFrom-Json
            $serverId = $config.server_id
        } catch {}
    }
    
    Write-Host ""
    Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║           vStats Agent Installation Complete!             ║" -ForegroundColor Green
    Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Server Name:   " -ForegroundColor Cyan -NoNewline; Write-Host $ServerName
    Write-Host "  Server ID:     " -ForegroundColor Cyan -NoNewline; Write-Host $serverId
    Write-Host "  Dashboard:     " -ForegroundColor Cyan -NoNewline; Write-Host $ServerUrl
    Write-Host ""
    Write-Host "  Service Commands (Run as Administrator):" -ForegroundColor Cyan
    Write-Host "    sc query $SERVICE_NAME           # Check status"
    Write-Host "    sc stop $SERVICE_NAME            # Stop service"
    Write-Host "    sc start $SERVICE_NAME           # Start service"
    Write-Host "    sc delete $SERVICE_NAME          # Remove service (uninstall)"
    Write-Host ""
    Write-Host "  PowerShell Commands:" -ForegroundColor Cyan
    Write-Host "    Get-Service $SERVICE_NAME        # Check status"
    Write-Host "    Stop-Service $SERVICE_NAME       # Stop service"
    Write-Host "    Start-Service $SERVICE_NAME      # Start service"
    Write-Host ""
    Write-Host "  View logs in Event Viewer > Windows Logs > Application"
    Write-Host ""
}

# Exported function for web install
function Install-VStatsAgent {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Server,
        
        [Parameter(Mandatory=$true)]
        [string]$Token,
        
        [string]$Name = $env:COMPUTERNAME
    )
    
    Show-Banner
    
    $version = Get-LatestVersion
    Install-Binary -Version $version
    Register-Agent -ServerUrl $Server -AuthToken $Token -ServerName $Name
    Install-Service
    Show-Complete -ServerUrl $Server -ServerName $Name
}

# Exported function for web upgrade
function Update-VStatsAgent {
    # Check admin rights for web install
    if (-not (Test-Administrator)) {
        Write-Host ""
        Write-Host "⚠️  Administrator privileges required" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Please run PowerShell as Administrator, then run:" -ForegroundColor Cyan
        Write-Host "  . {irm https://vstats.zsoft.cc/agent.ps1}; Update-VStatsAgent" -ForegroundColor White
        Write-Host ""
        exit 1
    }
    Show-Banner
    Upgrade-Agent
}

# Exported function for web uninstall
function Uninstall-VStatsAgent {
    # Check admin rights for web install
    if (-not (Test-Administrator)) {
        Write-Host ""
        Write-Host "⚠️  Administrator privileges required" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Please run PowerShell as Administrator, then run:" -ForegroundColor Cyan
        Write-Host "  . {irm https://vstats.zsoft.cc/agent.ps1}; Uninstall-VStatsAgent" -ForegroundColor White
        Write-Host ""
        exit 1
    }
    Show-Banner
    Uninstall-Agent
}

# Main
function Main {
    Show-Banner
    
    if ($Help) {
        Show-Help
        exit 0
    }
    
    if ($Uninstall) {
        Uninstall-Agent
    }
    
    if ($Upgrade) {
        Upgrade-Agent
    }
    
    # Normal install
    $version = Get-LatestVersion
    Install-Binary -Version $version
    Register-Agent -ServerUrl $Server -AuthToken $Token -ServerName $Name
    Install-Service
    Show-Complete -ServerUrl $Server -ServerName $Name
}

# Auto-execute for pipeline installs (irm ... | iex)
# Check if running via pipeline and no parameters provided
if ($MyInvocation.InvocationName -eq '.' -or $MyInvocation.InvocationName -eq '') {
    # If no parameters and running via pipeline, check for action in URL or environment
    $requestUri = $MyInvocation.Line
    if ($requestUri -match '\?action=(upgrade|uninstall)') {
        $action = $matches[1]
        if ($action -eq 'upgrade') {
            Update-VStatsAgent
            exit 0
        } elseif ($action -eq 'uninstall') {
            Uninstall-VStatsAgent
            exit 0
        }
    }
    # If no action specified, just load functions (don't execute Main)
    return
}

# Auto-execute for pipeline installs (irm ... | iex)
# When executed via pipeline without parameters, just load functions
if ($MyInvocation.InvocationName -eq '.' -or ($MyInvocation.InvocationName -eq '' -and -not $PSBoundParameters.Count)) {
    # If no action specified, just load functions (don't execute Main)
    return
}

# Run if script is executed directly (not dot-sourced)
if ($MyInvocation.InvocationName -ne '.') {
    Main
}

