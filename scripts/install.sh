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
    fi
    
    info "Detected: $OS-$ARCH"
}

# Get latest version from GitHub
get_latest_version() {
    info "Fetching latest version..."
    
    if command -v curl &> /dev/null; then
        LATEST_VERSION=$(curl -fsSL "$GITHUB_API" | grep '"tag_name"' | head -1 | cut -d'"' -f4)
    elif command -v wget &> /dev/null; then
        LATEST_VERSION=$(wget -qO- "$GITHUB_API" | grep '"tag_name"' | head -1 | cut -d'"' -f4)
    else
        error "curl or wget is required"
    fi
    
    if [ -z "$LATEST_VERSION" ]; then
        warn "Could not fetch latest version, using v1.0.0"
        LATEST_VERSION="v1.0.0"
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
    
    # Construct download URL
    BINARY_NAME="vstats-server-${OS}-${ARCH}"
    if [ "$OS" = "linux" ]; then
        BINARY_NAME="vstats-server-${OS}-${ARCH}-${LIBC}"
    fi
    
    DOWNLOAD_URL="${GITHUB_DOWNLOAD}/${LATEST_VERSION}/${BINARY_NAME}"
    
    info "Downloading from: $DOWNLOAD_URL"
    
    if curl -fsSL "$DOWNLOAD_URL" -o "$INSTALL_DIR/vstats-server" 2>/dev/null; then
        chmod +x "$INSTALL_DIR/vstats-server"
        success "Downloaded binary successfully"
    else
        # Try alternative naming
        DOWNLOAD_URL="${GITHUB_DOWNLOAD}/${LATEST_VERSION}/vstats-server-${OS}-${ARCH}"
        if curl -fsSL "$DOWNLOAD_URL" -o "$INSTALL_DIR/vstats-server" 2>/dev/null; then
            chmod +x "$INSTALL_DIR/vstats-server"
            success "Downloaded binary successfully"
        else
            error "Failed to download binary. Please check https://github.com/${GITHUB_REPO}/releases"
        fi
    fi
}

# Download web assets
download_web() {
    info "Downloading web assets..."
    
    WEB_URL="${GITHUB_DOWNLOAD}/${LATEST_VERSION}/web-dist.tar.gz"
    
    if curl -fsSL "$WEB_URL" -o "/tmp/vstats-web.tar.gz" 2>/dev/null; then
        tar -xzf "/tmp/vstats-web.tar.gz" -C "$INSTALL_DIR/web"
        rm -f "/tmp/vstats-web.tar.gz"
        success "Downloaded web assets"
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
    info "Upgrading vStats..."
    
    detect_system
    get_latest_version
    
    # Check current version
    if [ -f "$INSTALL_DIR/version" ]; then
        CURRENT_VERSION=$(cat "$INSTALL_DIR/version")
        if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
            success "Already running latest version: $LATEST_VERSION"
            exit 0
        fi
        info "Upgrading from $CURRENT_VERSION to $LATEST_VERSION"
    fi
    
    if [ "$OS" = "darwin" ]; then
        PLIST_FILE="$HOME/Library/LaunchAgents/com.vstats.server.plist"
        launchctl unload "$PLIST_FILE" 2>/dev/null || true
    else
        systemctl stop $SERVICE_NAME 2>/dev/null || true
    fi
    
    download_binary
    download_web
    
    echo "$LATEST_VERSION" > "$INSTALL_DIR/version"
    
    if [ "$OS" = "darwin" ]; then
        launchctl load "$PLIST_FILE" 2>/dev/null || true
    else
        systemctl start $SERVICE_NAME
    fi
    
    success "Upgraded to $LATEST_VERSION"
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
            upgrade
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
