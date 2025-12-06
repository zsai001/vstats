#!/bin/bash
#
# vStats - Server Monitoring Dashboard
# One-click installation script
#
# Usage:
#   curl -fsSL https://vstats.zsoft.cc/install.sh | sudo bash
#   or
#   wget -qO- https://vstats.zsoft.cc/install.sh | sudo bash
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="/opt/vstats"
SERVICE_NAME="vstats"
DEFAULT_PORT=3001
GITHUB_REPO="zsai001/vstats"
GITHUB_API="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"
GITHUB_DOWNLOAD="https://github.com/${GITHUB_REPO}/releases/download"

# Print banner
print_banner() {
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════════════╗"
    echo "║      vStats - Server Monitoring Dashboard         ║"
    echo "║            One-Click Installation                 ║"
    echo "╚═══════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Print colored message
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Check if running as root (skip on macOS)
check_root() {
    if [ "$OS" = "darwin" ]; then
        # macOS doesn't need root for most operations
        return 0
    fi
    
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
        armv7l) ARCH="arm" ;;
        *) error "Unsupported architecture: $ARCH" ;;
    esac
    
    case "$OS" in
        linux) OS="linux" ;;
        darwin) OS="darwin" ;;
        freebsd) OS="freebsd" ;;
        *) error "Unsupported OS: $OS" ;;
    esac
    
    info "Detected: $OS-$ARCH"
}

# Get latest version from GitHub
get_latest_version() {
    info "Fetching latest version..."
    
    if command -v curl &> /dev/null; then
        LATEST_VERSION=$(curl -fsSL "$GITHUB_API" 2>/dev/null | grep '"tag_name"' | head -1 | cut -d'"' -f4)
    elif command -v wget &> /dev/null; then
        LATEST_VERSION=$(wget -qO- "$GITHUB_API" 2>/dev/null | grep '"tag_name"' | head -1 | cut -d'"' -f4)
    else
        error "curl or wget is required"
    fi
    
    if [ -z "$LATEST_VERSION" ]; then
        error "Could not fetch latest version from GitHub. This may be due to rate limiting. Please try again later or check your network connection."
    fi
    
    success "Latest version: $LATEST_VERSION"
}

# Install dependencies
install_deps() {
    info "Checking dependencies..."
    
    if command -v curl &> /dev/null; then
        success "curl is installed"
    else
        warn "Installing curl..."
        if command -v apt-get &> /dev/null; then
            apt-get update && apt-get install -y curl
        elif command -v yum &> /dev/null; then
            yum install -y curl
        elif command -v dnf &> /dev/null; then
            dnf install -y curl
        elif command -v apk &> /dev/null; then
            apk add --no-cache curl
        fi
    fi
}

# Create installation directory
setup_dirs() {
    info "Setting up directories..."
    
    # On macOS, use user directory if not root
    if [ "$OS" = "darwin" ] && [ "$EUID" -ne 0 ]; then
        INSTALL_DIR="$HOME/.vstats"
        info "Using user directory: $INSTALL_DIR"
    fi
    
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR/data"
    mkdir -p "$INSTALL_DIR/web"
}

# Download and install binary
download_binary() {
    info "Downloading vStats server ${LATEST_VERSION}..."
    
    # Construct download URL (Go binary naming: vstats-server-{os}-{arch})
    BINARY_NAME="vstats-server-${OS}-${ARCH}"
    
    DOWNLOAD_URL="${GITHUB_DOWNLOAD}/${LATEST_VERSION}/${BINARY_NAME}"
    
    info "Downloading from: $DOWNLOAD_URL"
    
    # Download with retry and better error handling
    local retry=0
    local max_retries=3
    
    while [ $retry -lt $max_retries ]; do
        if curl -L --fail --silent --show-error "$DOWNLOAD_URL" -o "$INSTALL_DIR/vstats-server" 2>&1; then
            # Verify the download is not empty and is executable
            if [ -s "$INSTALL_DIR/vstats-server" ]; then
                chmod +x "$INSTALL_DIR/vstats-server"
                success "Downloaded binary successfully"
                return 0
            else
                warn "Downloaded file is empty, retrying..."
                rm -f "$INSTALL_DIR/vstats-server"
            fi
        else
            warn "Download attempt $((retry + 1)) failed, retrying..."
        fi
        retry=$((retry + 1))
        sleep 2
    done
    
    error "Failed to download binary after $max_retries attempts. Please check https://github.com/${GITHUB_REPO}/releases"
}

# Download web assets
download_web() {
    info "Downloading web assets..."
    
    # Try tar.gz first, then zip
    WEB_URL_TAR="${GITHUB_DOWNLOAD}/${LATEST_VERSION}/web-dist.tar.gz"
    WEB_URL_ZIP="${GITHUB_DOWNLOAD}/${LATEST_VERSION}/web-dist.zip"
    
    if curl -L --fail --silent "$WEB_URL_TAR" -o "/tmp/vstats-web.tar.gz" 2>/dev/null; then
        tar -xzf "/tmp/vstats-web.tar.gz" -C "$INSTALL_DIR/web"
        rm -f "/tmp/vstats-web.tar.gz"
        success "Downloaded web assets (tar.gz)"
    elif curl -L --fail --silent "$WEB_URL_ZIP" -o "/tmp/vstats-web.zip" 2>/dev/null; then
        if command -v unzip &> /dev/null; then
            unzip -q "/tmp/vstats-web.zip" -d "$INSTALL_DIR/web"
            rm -f "/tmp/vstats-web.zip"
            success "Downloaded web assets (zip)"
        else
            warn "unzip not found, trying to install..."
            if command -v apt-get &> /dev/null; then
                apt-get update && apt-get install -y unzip
                unzip -q "/tmp/vstats-web.zip" -d "$INSTALL_DIR/web"
                rm -f "/tmp/vstats-web.zip"
                success "Downloaded web assets (zip)"
            else
                warn "Could not extract web assets. Dashboard may serve embedded assets."
                rm -f "/tmp/vstats-web.zip"
            fi
        fi
    else
        warn "Could not download web assets. Dashboard may serve embedded assets."
    fi
}

# Generate configuration
generate_config() {
    info "Generating configuration..."
    
    # Generate random password if not exists
    if [ ! -f "$INSTALL_DIR/data/vstats-config.json" ]; then
        ADMIN_PASS=$(openssl rand -base64 12 | tr -dc 'a-zA-Z0-9' | head -c 12 || head -c 12 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 12)
        
        cat > "$INSTALL_DIR/data/vstats-config.json" << EOF
{
  "port": $DEFAULT_PORT,
  "admin_password": "$ADMIN_PASS",
  "servers": []
}
EOF
        
        echo ""
        echo -e "${GREEN}═══════════════════════════════════════════${NC}"
        echo -e "${GREEN}  Admin Password: ${YELLOW}$ADMIN_PASS${NC}"
        echo -e "${GREEN}  Please save this password!${NC}"
        echo -e "${GREEN}═══════════════════════════════════════════${NC}"
        echo ""
    else
        success "Existing configuration preserved"
    fi
}

# Create systemd service (Linux)
create_systemd_service() {
    info "Creating systemd service..."
    
    cat > /etc/systemd/system/$SERVICE_NAME.service << EOF
[Unit]
Description=vStats Server Monitor Dashboard
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR/data
ExecStart=$INSTALL_DIR/vstats-server
Restart=always
RestartSec=5
Environment=RUST_LOG=info
Environment=VSTATS_PORT=$DEFAULT_PORT
Environment=VSTATS_WEB_DIR=$INSTALL_DIR/web

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable $SERVICE_NAME
    systemctl start $SERVICE_NAME
    
    success "Service created and started"
}

# Create launchd service (macOS)
create_launchd_service() {
    info "Creating launchd service..."
    
    PLIST_FILE="$HOME/Library/LaunchAgents/com.vstats.server.plist"
    mkdir -p "$HOME/Library/LaunchAgents"
    
    cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.vstats.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>$INSTALL_DIR/vstats-server</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$INSTALL_DIR/data</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$INSTALL_DIR/data/vstats.log</string>
    <key>StandardErrorPath</key>
    <string>$INSTALL_DIR/data/vstats.error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>RUST_LOG</key>
        <string>info</string>
        <key>VSTATS_PORT</key>
        <string>$DEFAULT_PORT</string>
        <key>VSTATS_WEB_DIR</key>
        <string>$INSTALL_DIR/web</string>
    </dict>
</dict>
</plist>
EOF

    # Load the service
    launchctl unload "$PLIST_FILE" 2>/dev/null || true
    launchctl load "$PLIST_FILE"
    
    success "Service created and started"
}

# Create service (OS-agnostic wrapper)
create_service() {
    if [ "$OS" = "darwin" ]; then
        create_launchd_service
    else
        create_systemd_service
    fi
}

# Configure firewall
configure_firewall() {
    if [ "$OS" = "darwin" ]; then
        # macOS firewall is usually managed through System Preferences
        warn "macOS firewall: Please manually allow port $DEFAULT_PORT in System Preferences > Security & Privacy > Firewall"
        return
    fi
    
    info "Configuring firewall..."
    
    if command -v ufw &> /dev/null; then
        ufw allow $DEFAULT_PORT/tcp 2>/dev/null || true
        success "UFW rule added"
    elif command -v firewall-cmd &> /dev/null; then
        firewall-cmd --permanent --add-port=$DEFAULT_PORT/tcp 2>/dev/null || true
        firewall-cmd --reload 2>/dev/null || true
        success "Firewalld rule added"
    else
        warn "No firewall detected. Please manually open port $DEFAULT_PORT if needed"
    fi
}

# Print completion message
print_complete() {
    if [ "$OS" = "darwin" ]; then
        LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")
    else
        LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || curl -s ifconfig.me 2>/dev/null || echo "your-server-ip")
    fi
    
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           vStats Installation Complete!                   ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${CYAN}Version:${NC}        $LATEST_VERSION"
    echo -e "  ${CYAN}Dashboard URL:${NC}  http://$LOCAL_IP:$DEFAULT_PORT"
    echo -e "  ${CYAN}Password:${NC}       admin (or generated password above)"
    echo ""
    echo -e "  ${YELLOW}To add a server to monitor, run this on the target server:${NC}"
    echo ""
    echo -e "  ${WHITE}curl -fsSL https://vstats.zsoft.cc/agent.sh | sudo bash -s -- \\${NC}"
    echo -e "  ${WHITE}  --server http://$LOCAL_IP:$DEFAULT_PORT \\${NC}"
    echo -e "  ${WHITE}  --name \"\$(hostname)\" \\${NC}"
    echo -e "  ${WHITE}  --token \"your-token\"${NC}"
    echo ""
    echo -e "  ${CYAN}Service Commands:${NC}"
    if [ "$OS" = "darwin" ]; then
        echo "    launchctl list | grep vstats        # Check status"
        echo "    launchctl unload ~/Library/LaunchAgents/com.vstats.server.plist  # Stop"
        echo "    launchctl load ~/Library/LaunchAgents/com.vstats.server.plist    # Start"
        echo "    tail -f $INSTALL_DIR/data/vstats.log  # View logs"
    else
        echo "    systemctl status $SERVICE_NAME   # Check status"
        echo "    systemctl restart $SERVICE_NAME  # Restart"
        echo "    systemctl stop $SERVICE_NAME     # Stop"
        echo "    journalctl -u $SERVICE_NAME -f   # View logs"
    fi
    echo ""
    echo -e "  ${CYAN}Documentation:${NC} https://vstats.zsoft.cc"
    echo ""
}

# Uninstall function
uninstall() {
    echo -e "${YELLOW}Uninstalling vStats...${NC}"
    
    if [ "$OS" = "darwin" ]; then
        PLIST_FILE="$HOME/Library/LaunchAgents/com.vstats.server.plist"
        launchctl unload "$PLIST_FILE" 2>/dev/null || true
        rm -f "$PLIST_FILE"
    else
        systemctl stop $SERVICE_NAME 2>/dev/null || true
        systemctl disable $SERVICE_NAME 2>/dev/null || true
        rm -f /etc/systemd/system/$SERVICE_NAME.service
        systemctl daemon-reload
    fi
    
    read -p "Remove all data? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$INSTALL_DIR"
        success "All data removed"
    else
        rm -f "$INSTALL_DIR/vstats-server"
        rm -rf "$INSTALL_DIR/web"
        success "Binary removed, data preserved in $INSTALL_DIR/data"
    fi
    
    success "vStats uninstalled"
    exit 0
}

# Upgrade function
upgrade() {
    local force_upgrade=false
    
    # Check for --force flag
    for arg in "$@"; do
        case "$arg" in
            --force|-f)
                force_upgrade=true
                ;;
        esac
    done
    
    info "Upgrading vStats..."
    
    detect_system
    get_latest_version
    
    # Check current version
    if [ -f "$INSTALL_DIR/version" ]; then
        CURRENT_VERSION=$(cat "$INSTALL_DIR/version")
        if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
            if [ "$force_upgrade" = true ]; then
                warn "Force reinstalling version: $LATEST_VERSION"
            else
                success "Already running latest version: $LATEST_VERSION"
                info "Use --force to reinstall the same version"
                exit 0
            fi
        else
            info "Upgrading from $CURRENT_VERSION to $LATEST_VERSION"
        fi
    fi
    
    # Download files FIRST before stopping service
    # This ensures files are ready before we stop
    info "Downloading new version..."
    download_binary
    download_web
    echo "$LATEST_VERSION" > "$INSTALL_DIR/version"
    
    # Now restart the service
    if [ "$OS" = "darwin" ]; then
        PLIST_FILE="$HOME/Library/LaunchAgents/com.vstats.server.plist"
        launchctl unload "$PLIST_FILE" 2>/dev/null || true
        launchctl load "$PLIST_FILE" 2>/dev/null || true
    else
        # Use systemd-run to spawn restart in a separate transient unit
        # This ensures the restart survives even if parent process is killed
        # --no-block returns immediately without waiting
        systemd-run --no-block systemctl restart $SERVICE_NAME
    fi
    
    success "Upgraded to $LATEST_VERSION"
    info "Service is restarting..."
    exit 0
}

# Show version
show_version() {
    if [ -f "$INSTALL_DIR/version" ]; then
        echo "vStats $(cat $INSTALL_DIR/version)"
    else
        echo "vStats (version unknown)"
    fi
    exit 0
}

# Main installation flow
main() {
    print_banner
    
    # Handle flags
    case "$1" in
        uninstall|--uninstall|-u)
            detect_system
            check_root
            uninstall
            ;;
        upgrade|--upgrade)
            detect_system
            check_root
            shift  # Remove first argument
            upgrade "$@"
            ;;
        version|--version|-v)
            show_version
            ;;
    esac
    
    detect_system
    check_root
    get_latest_version
    install_deps
    setup_dirs
    download_binary
    download_web
    generate_config
    create_service
    configure_firewall
    
    # Save version
    echo "$LATEST_VERSION" > "$INSTALL_DIR/version"
    
    print_complete
}

main "$@"
