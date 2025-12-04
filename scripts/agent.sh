#!/bin/bash
#
# vStats Agent Installer
# Downloads and installs the Rust agent binary
#
# Usage:
#   curl -fsSL https://vstats.zsoft.cc/agent.sh | sudo bash -s -- \
#     --server http://dashboard-ip:3001 \
#     --name "My Server" \
#     --token "your-admin-token"
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/vstats-agent"
SERVICE_NAME="vstats-agent"
GITHUB_REPO="zsai001/vstats"
GITHUB_API="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"

# Print banner
print_banner() {
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════════════╗"
    echo "║        vStats Agent - Monitoring Probe            ║"
    echo "║              Rust Binary Installer                ║"
    echo "╚═══════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Print colored message
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Parse arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --server|-s)
                DASHBOARD_URL="$2"
                shift 2
                ;;
            --name|-n)
                SERVER_NAME="$2"
                shift 2
                ;;
            --token|-t)
                AUTH_TOKEN="$2"
                shift 2
                ;;
            --uninstall)
                UNINSTALL=true
                shift
                ;;
            --upgrade)
                UPGRADE=true
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                warn "Unknown option: $1"
                shift
                ;;
        esac
    done
    
    # Set defaults
    SERVER_NAME=${SERVER_NAME:-$(hostname)}
}

show_help() {
    echo "vStats Agent Installation Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --server, -s URL     Dashboard server URL (required)"
    echo "  --name, -n NAME      Server display name (default: hostname)"
    echo "  --token, -t TOKEN    Admin authentication token (required)"
    echo "  --location, -l LOC   Server location (e.g., 'US', 'CN')"
    echo "  --provider, -p NAME  Hosting provider (e.g., 'Vultr', 'AWS')"
    echo "  --uninstall          Uninstall agent"
    echo "  --upgrade            Upgrade to latest version"
    echo "  --help, -h           Show this help"
    echo ""
    echo "Example:"
    echo "  curl -fsSL https://vstats.zsoft.cc/agent.sh | sudo bash -s -- \\"
    echo "    --server http://dashboard:3001 \\"
    echo "    --token 'admin-jwt-token' \\"
    echo "    --name 'US-Server-1'"
}

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        error "Please run as root (use sudo)"
    fi
}

# Detect OS and architecture
detect_system() {
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)
    
    # Map architecture names to Go naming convention
    case "$ARCH" in
        x86_64|amd64) ARCH="amd64" ;;
        aarch64|arm64) ARCH="arm64" ;;
        *) error "Unsupported architecture: $ARCH" ;;
    esac
    
    case "$OS" in
        linux) OS="linux" ;;
        darwin) OS="darwin" ;;
        freebsd) OS="freebsd" ;;
        *) error "Unsupported OS: $OS" ;;
    esac
    
    # Go binary naming: vstats-agent-{os}-{arch}
    BINARY_NAME="vstats-agent-${OS}-${ARCH}"
    
    info "Detected: $OS-$ARCH"
}

# Get latest version from GitHub
get_latest_version() {
    info "Fetching latest version..."
    
    if command -v curl &> /dev/null; then
        LATEST_VERSION=$(curl -fsSL "$GITHUB_API" 2>/dev/null | grep '"tag_name"' | head -1 | cut -d'"' -f4)
    elif command -v wget &> /dev/null; then
        LATEST_VERSION=$(wget -qO- "$GITHUB_API" 2>/dev/null | grep '"tag_name"' | head -1 | cut -d'"' -f4)
    fi
    
    if [ -z "$LATEST_VERSION" ]; then
        error "Could not fetch latest version from GitHub. This may be due to rate limiting. Please try again later or check your network connection."
    fi
    
    success "Latest version: $LATEST_VERSION"
}

# Download binary
download_binary() {
    info "Downloading vstats-agent $LATEST_VERSION..."
    
    DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/download/${LATEST_VERSION}/${BINARY_NAME}"
    
    info "URL: $DOWNLOAD_URL"
    
    # Download with retry
    local retry=0
    local max_retries=3
    
    while [ $retry -lt $max_retries ]; do
        if command -v curl &> /dev/null; then
            if curl -L --fail --silent --show-error "$DOWNLOAD_URL" -o /tmp/vstats-agent 2>&1; then
                if [ -s /tmp/vstats-agent ]; then
                    chmod +x /tmp/vstats-agent
                    # Verify it's actually executable
                    if [ ! -x /tmp/vstats-agent ]; then
                        warn "Downloaded file is not executable, fixing permissions..."
                        chmod +x /tmp/vstats-agent
                    fi
                    mv /tmp/vstats-agent "$INSTALL_DIR/vstats-agent"
                    # Verify final binary exists and is executable
                    if [ -f "$INSTALL_DIR/vstats-agent" ] && [ -x "$INSTALL_DIR/vstats-agent" ]; then
                        success "Binary installed to $INSTALL_DIR/vstats-agent"
                        # Test that binary works
                        if "$INSTALL_DIR/vstats-agent" version &>/dev/null; then
                            success "Binary verified and working"
                        else
                            warn "Binary exists but version check failed"
                        fi
                        return 0
                    else
                        error "Binary installation verification failed"
                    fi
                else
                    warn "Downloaded file is empty"
                fi
            fi
        elif command -v wget &> /dev/null; then
            if wget -q "$DOWNLOAD_URL" -O /tmp/vstats-agent 2>&1; then
                if [ -s /tmp/vstats-agent ]; then
                    chmod +x /tmp/vstats-agent
                    if [ ! -x /tmp/vstats-agent ]; then
                        warn "Downloaded file is not executable, fixing permissions..."
                        chmod +x /tmp/vstats-agent
                    fi
                    mv /tmp/vstats-agent "$INSTALL_DIR/vstats-agent"
                    if [ -f "$INSTALL_DIR/vstats-agent" ] && [ -x "$INSTALL_DIR/vstats-agent" ]; then
                        success "Binary installed to $INSTALL_DIR/vstats-agent"
                        if "$INSTALL_DIR/vstats-agent" version &>/dev/null; then
                            success "Binary verified and working"
                        else
                            warn "Binary exists but version check failed"
                        fi
                        return 0
                    else
                        error "Binary installation verification failed"
                    fi
                else
                    warn "Downloaded file is empty"
                fi
            fi
        else
            error "curl or wget is required"
        fi
        
        warn "Download attempt $((retry + 1)) failed, retrying..."
        rm -f /tmp/vstats-agent
        retry=$((retry + 1))
        sleep 2
    done
    
    error "Failed to download binary after $max_retries attempts. Check https://github.com/${GITHUB_REPO}/releases"
}

# Setup directories
setup_dirs() {
    info "Setting up directories..."
    mkdir -p "$CONFIG_DIR"
}

# Register and create config using the Rust agent
register_agent() {
    if [ -z "$DASHBOARD_URL" ] || [ -z "$AUTH_TOKEN" ]; then
        error "Dashboard URL and admin token required. Use --server and --token flags."
    fi
    
    # Verify binary exists before registration
    if [ ! -f "$INSTALL_DIR/vstats-agent" ]; then
        error "Agent binary not found at $INSTALL_DIR/vstats-agent. Download may have failed."
    fi
    
    if [ ! -x "$INSTALL_DIR/vstats-agent" ]; then
        chmod +x "$INSTALL_DIR/vstats-agent"
    fi
    
    info "Registering with dashboard..."
    info "  Server: $DASHBOARD_URL"
    info "  Name: $SERVER_NAME"
    
    # Use the agent to register
    if ! "$INSTALL_DIR/vstats-agent" register \
        --server "$DASHBOARD_URL" \
        --token "$AUTH_TOKEN" \
        --name "$SERVER_NAME" \
        --config "$CONFIG_DIR/vstats-agent.json" 2>&1; then
        error "Registration failed. Check the error message above."
    fi
    
    # Verify config was created
    if [ ! -f "$CONFIG_DIR/vstats-agent.json" ]; then
        error "Registration succeeded but config file was not created"
    fi
    
    success "Registered successfully!"
}

# Install systemd service
install_service() {
    info "Installing systemd service..."
    
    # Verify binary exists
    if [ ! -f "$INSTALL_DIR/vstats-agent" ]; then
        error "Agent binary not found at $INSTALL_DIR/vstats-agent"
    fi
    
    # Verify binary is executable
    if [ ! -x "$INSTALL_DIR/vstats-agent" ]; then
        warn "Binary is not executable, fixing permissions..."
        chmod +x "$INSTALL_DIR/vstats-agent"
    fi
    
    # Verify config exists
    if [ ! -f "$CONFIG_DIR/vstats-agent.json" ]; then
        error "Config file not found at $CONFIG_DIR/vstats-agent.json"
    fi
    
    # Try using the agent's install command
    if "$INSTALL_DIR/vstats-agent" install --config "$CONFIG_DIR/vstats-agent.json" 2>&1; then
        info "Service installed using agent command"
    else
        # Fallback: create service manually
        warn "Auto-install failed, creating service manually..."
        
        cat > /etc/systemd/system/$SERVICE_NAME.service << EOF
[Unit]
Description=vStats Monitoring Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=$INSTALL_DIR/vstats-agent run --config $CONFIG_DIR/vstats-agent.json
Restart=always
RestartSec=10
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
EOF

        if [ $? -ne 0 ]; then
            error "Failed to create service file"
        fi
        
        info "Reloading systemd daemon..."
        systemctl daemon-reload || error "Failed to reload systemd"
        
        info "Enabling service..."
        systemctl enable $SERVICE_NAME || error "Failed to enable service"
        
        info "Starting service..."
        systemctl start $SERVICE_NAME || error "Failed to start service"
    fi
    
    # Wait a moment for service to start
    sleep 2
    
    # Verify service is running
    if systemctl is-active --quiet $SERVICE_NAME; then
        success "Service installed and started successfully"
    else
        warn "Service installed but not running. Checking status..."
        systemctl status $SERVICE_NAME --no-pager -l || true
        error "Service failed to start. Check logs with: journalctl -u $SERVICE_NAME -n 50"
    fi
}

# Print completion message
print_complete() {
    # Read config to get server info
    if [ -f "$CONFIG_DIR/vstats-agent.json" ]; then
        SERVER_ID=$(grep -o '"server_id":"[^"]*"' "$CONFIG_DIR/vstats-agent.json" | cut -d'"' -f4)
    fi
    
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           vStats Agent Installation Complete!             ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${CYAN}Server Name:${NC}   $SERVER_NAME"
    echo -e "  ${CYAN}Server ID:${NC}     ${SERVER_ID:-N/A}"
    echo -e "  ${CYAN}Dashboard:${NC}     $DASHBOARD_URL"
    echo -e "  ${CYAN}Location:${NC}      $LOCATION"
    echo -e "  ${CYAN}Provider:${NC}      $PROVIDER"
    echo ""
    echo -e "  ${CYAN}Service Commands:${NC}"
    echo "    systemctl status $SERVICE_NAME   # Check status"
    echo "    systemctl restart $SERVICE_NAME  # Restart"
    echo "    systemctl stop $SERVICE_NAME     # Stop"
    echo "    journalctl -u $SERVICE_NAME -f   # View logs"
    echo ""
}

# Uninstall function
uninstall() {
    echo -e "${YELLOW}Uninstalling vStats Agent...${NC}"
    
    # Try using the agent's uninstall command first
    if [ -f "$INSTALL_DIR/vstats-agent" ]; then
        "$INSTALL_DIR/vstats-agent" uninstall 2>/dev/null || true
    fi
    
    # Manual cleanup
    systemctl stop $SERVICE_NAME 2>/dev/null || true
    systemctl disable $SERVICE_NAME 2>/dev/null || true
    rm -f /etc/systemd/system/$SERVICE_NAME.service
    systemctl daemon-reload
    rm -f "$INSTALL_DIR/vstats-agent"
    rm -rf "$CONFIG_DIR"
    
    # Clean up old shell agent if present
    rm -rf "/opt/vstats-agent"
    
    success "vStats Agent uninstalled"
    exit 0
}

# Upgrade function
upgrade() {
    info "Upgrading vStats Agent..."
    
    detect_system
    get_latest_version
    
    # Stop service
    systemctl stop $SERVICE_NAME 2>/dev/null || true
    
    # Download new binary
    download_binary
    
    # Restart service
    systemctl start $SERVICE_NAME 2>/dev/null || true
    
    success "Upgraded to $LATEST_VERSION"
    exit 0
}

# Main installation flow
main() {
    print_banner
    parse_args "$@"
    
    # Handle uninstall/upgrade
    if [ "$UNINSTALL" = true ]; then
        check_root
        uninstall
    fi
    
    if [ "$UPGRADE" = true ]; then
        check_root
        upgrade
    fi
    
    check_root
    detect_system
    get_latest_version
    setup_dirs
    download_binary
    register_agent
    install_service
    print_complete
}

main "$@"
