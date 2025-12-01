#!/bin/bash
#
# vStats Agent Installer
# Downloads and installs the pre-built Rust agent binary
#
# Usage:
#   curl -fsSL https://vstats.zsoft.cc/install.sh | sudo bash -s -- \
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
            --location|-l)
                LOCATION="$2"
                shift 2
                ;;
            --provider|-p)
                PROVIDER="$2"
                shift 2
                ;;
            --server-id)
                SERVER_ID="$2"
                shift 2
                ;;
            --agent-token)
                AGENT_TOKEN="$2"
                shift 2
                ;;
            --uninstall)
                UNINSTALL=true
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
    LOCATION=${LOCATION:-"Unknown"}
    PROVIDER=${PROVIDER:-"Unknown"}
}

show_help() {
    echo "vStats Agent Installation Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --server, -s URL     Dashboard server URL (required)"
    echo "  --name, -n NAME      Server display name (default: hostname)"
    echo "  --token, -t TOKEN    Admin authentication token (for auto-registration)"
    echo "  --location, -l LOC   Server location (e.g., 'US', 'CN')"
    echo "  --provider, -p NAME  Hosting provider (e.g., 'Vultr', 'AWS')"
    echo "  --server-id ID       Pre-registered server ID (skip registration)"
    echo "  --agent-token TOKEN  Pre-registered agent token (skip registration)"
    echo "  --uninstall          Uninstall agent"
    echo "  --help, -h           Show this help"
    echo ""
    echo "Example:"
    echo "  curl -fsSL https://vstats.zsoft.cc/install.sh | sudo bash -s -- \\"
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
    
    case "$ARCH" in
        x86_64|amd64) ARCH="x86_64" ;;
        aarch64|arm64) ARCH="aarch64" ;;
        armv7l) ARCH="armv7" ;;
        *) error "Unsupported architecture: $ARCH" ;;
    esac
    
    case "$OS" in
        linux) OS="linux" ;;
        darwin) OS="darwin" ;;
        *) error "Unsupported OS: $OS" ;;
    esac
    
    # Detect libc type for Linux
    if [ "$OS" = "linux" ]; then
        if ldd --version 2>&1 | grep -q musl; then
            LIBC="musl"
        else
            LIBC="gnu"
        fi
        BINARY_NAME="vstats-agent-${OS}-${ARCH}-${LIBC}"
    else
        BINARY_NAME="vstats-agent-${OS}-${ARCH}"
    fi
    
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
        warn "Could not fetch latest version, using v1.0.0"
        LATEST_VERSION="v1.0.0"
    fi
    
    success "Latest version: $LATEST_VERSION"
}

# Download binary
download_binary() {
    info "Downloading vstats-agent..."
    
    DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/download/${LATEST_VERSION}/${BINARY_NAME}"
    
    if command -v curl &> /dev/null; then
        curl -fsSL "$DOWNLOAD_URL" -o /tmp/vstats-agent 2>/dev/null
    elif command -v wget &> /dev/null; then
        wget -qO /tmp/vstats-agent "$DOWNLOAD_URL" 2>/dev/null
    fi
    
    if [ ! -f /tmp/vstats-agent ]; then
        warn "Could not download pre-built binary, falling back to shell agent"
        USE_SHELL_AGENT=true
        return
    fi
    
    chmod +x /tmp/vstats-agent
    mv /tmp/vstats-agent "$INSTALL_DIR/vstats-agent"
    
    success "Binary installed to $INSTALL_DIR/vstats-agent"
}

# Setup directories
setup_dirs() {
    info "Setting up directories..."
    mkdir -p "$CONFIG_DIR"
}

# Register with dashboard
register_with_dashboard() {
    # Skip if already have server ID and token
    if [ -n "$SERVER_ID" ] && [ -n "$AGENT_TOKEN" ]; then
        info "Using provided server ID and token"
        return 0
    fi
    
    if [ -z "$DASHBOARD_URL" ] || [ -z "$AUTH_TOKEN" ]; then
        error "Dashboard URL and admin token required for registration. Use --server and --token flags."
    fi
    
    info "Registering with dashboard..."
    
    RESPONSE=$(curl -s -X POST "$DASHBOARD_URL/api/agent/register" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        -d "{
            \"name\": \"$SERVER_NAME\",
            \"location\": \"$LOCATION\",
            \"provider\": \"$PROVIDER\"
        }" 2>/dev/null)
    
    if echo "$RESPONSE" | grep -q '"id"'; then
        SERVER_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
        AGENT_TOKEN=$(echo "$RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
        success "Registered successfully!"
        info "Server ID: $SERVER_ID"
    else
        error "Registration failed. Response: $RESPONSE"
    fi
}

# Generate config
generate_config() {
    info "Generating configuration..."
    
    cat > "$CONFIG_DIR/vstats-agent.json" << EOF
{
  "dashboard_url": "$DASHBOARD_URL",
  "server_id": "$SERVER_ID",
  "agent_token": "$AGENT_TOKEN",
  "server_name": "$SERVER_NAME",
  "location": "$LOCATION",
  "provider": "$PROVIDER",
  "interval_secs": 1
}
EOF
    chmod 600 "$CONFIG_DIR/vstats-agent.json"
}

# Create systemd service
create_service() {
    info "Creating systemd service..."
    
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

    systemctl daemon-reload
    systemctl enable $SERVICE_NAME
    systemctl start $SERVICE_NAME
    
    success "Service created and started"
}

# Print completion message
print_complete() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           vStats Agent Installation Complete!             ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${CYAN}Server Name:${NC}   $SERVER_NAME"
    echo -e "  ${CYAN}Server ID:${NC}     $SERVER_ID"
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
    
    systemctl stop $SERVICE_NAME 2>/dev/null || true
    systemctl disable $SERVICE_NAME 2>/dev/null || true
    rm -f /etc/systemd/system/$SERVICE_NAME.service
    systemctl daemon-reload
    rm -f "$INSTALL_DIR/vstats-agent"
    rm -rf "$CONFIG_DIR"
    
    # Also clean up old shell agent if present
    rm -rf "/opt/vstats-agent"
    
    success "vStats Agent uninstalled"
    exit 0
}

# Main installation flow
main() {
    print_banner
    parse_args "$@"
    
    # Handle uninstall
    if [ "$UNINSTALL" = true ]; then
        check_root
        uninstall
    fi
    
    check_root
    detect_system
    setup_dirs
    get_latest_version
    download_binary
    
    if [ "$USE_SHELL_AGENT" != true ]; then
        register_with_dashboard
        generate_config
        create_service
        print_complete
    else
        warn "Binary download failed. Please build from source or use shell agent."
        exit 1
    fi
}

main "$@"

