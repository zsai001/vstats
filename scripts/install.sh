#!/bin/bash
#
# xProb - Server Monitoring Dashboard
# One-click installation script
#
# Usage:
#   curl -fsSL https://your-domain.com/install.sh | bash
#   or
#   wget -qO- https://your-domain.com/install.sh | bash
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
INSTALL_DIR="/opt/xprob"
SERVICE_NAME="xprob"
DEFAULT_PORT=3001
GITHUB_REPO="your-username/xprob"  # Update this

# Print banner
print_banner() {
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════╗"
    echo "║         xProb Server Monitor              ║"
    echo "║         Dashboard Installation            ║"
    echo "╚═══════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Print colored message
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

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
        *) error "Unsupported architecture: $ARCH" ;;
    esac
    
    case "$OS" in
        linux) OS="linux" ;;
        darwin) OS="darwin" ;;
        *) error "Unsupported OS: $OS" ;;
    esac
    
    info "Detected: $OS-$ARCH"
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
        fi
    fi
}

# Create installation directory
setup_dirs() {
    info "Setting up directories..."
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR/data"
    mkdir -p "$INSTALL_DIR/web"
}

# Download and install binary
install_binary() {
    info "Downloading xProb server..."
    
    # For now, build from source or download pre-built binary
    # In production, you would download from GitHub releases:
    # DOWNLOAD_URL="https://github.com/$GITHUB_REPO/releases/latest/download/xprob-server-$OS-$ARCH"
    # curl -fsSL "$DOWNLOAD_URL" -o "$INSTALL_DIR/xprob-server"
    
    # Check if binary exists locally (for development)
    if [ -f "./server/target/release/xprob-server" ]; then
        cp "./server/target/release/xprob-server" "$INSTALL_DIR/"
        success "Copied local binary"
    else
        warn "Binary not found. Please build from source:"
        echo "  cd server && cargo build --release"
        echo "  Then run this script again"
        exit 1
    fi
    
    chmod +x "$INSTALL_DIR/xprob-server"
}

# Install web assets
install_web() {
    info "Installing web assets..."
    
    if [ -d "./web/dist" ]; then
        cp -r "./web/dist/"* "$INSTALL_DIR/web/"
        success "Copied web assets"
    else
        warn "Web assets not found. Please build:"
        echo "  cd web && npm install && npm run build"
    fi
}

# Generate configuration
generate_config() {
    info "Generating configuration..."
    
    # Generate random password if not exists
    if [ ! -f "$INSTALL_DIR/data/xprob-config.json" ]; then
        ADMIN_PASS=$(openssl rand -base64 12 | tr -dc 'a-zA-Z0-9' | head -c 12)
        
        cat > "$INSTALL_DIR/data/xprob-config.json" << EOF
{
  "admin_password_hash": "$(echo -n "$ADMIN_PASS" | openssl passwd -6 -stdin 2>/dev/null || echo '$2b$12$default')",
  "servers": []
}
EOF
        
        echo ""
        echo -e "${GREEN}═══════════════════════════════════════════${NC}"
        echo -e "${GREEN}  Admin Password: ${YELLOW}$ADMIN_PASS${NC}"
        echo -e "${GREEN}  Please save this password!${NC}"
        echo -e "${GREEN}═══════════════════════════════════════════${NC}"
        echo ""
    fi
}

# Create systemd service
create_service() {
    info "Creating systemd service..."
    
    cat > /etc/systemd/system/$SERVICE_NAME.service << EOF
[Unit]
Description=xProb Server Monitor Dashboard
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR/data
ExecStart=$INSTALL_DIR/xprob-server
Restart=always
RestartSec=5
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable $SERVICE_NAME
    systemctl start $SERVICE_NAME
    
    success "Service created and started"
}

# Configure firewall
configure_firewall() {
    info "Configuring firewall..."
    
    if command -v ufw &> /dev/null; then
        ufw allow $DEFAULT_PORT/tcp
        success "UFW rule added"
    elif command -v firewall-cmd &> /dev/null; then
        firewall-cmd --permanent --add-port=$DEFAULT_PORT/tcp
        firewall-cmd --reload
        success "Firewalld rule added"
    else
        warn "No firewall detected. Please manually open port $DEFAULT_PORT"
    fi
}

# Print completion message
print_complete() {
    LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "your-server-ip")
    
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           xProb Installation Complete!                    ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${CYAN}Dashboard URL:${NC}  http://$LOCAL_IP:$DEFAULT_PORT"
    echo -e "  ${CYAN}Default Password:${NC} admin (or generated password above)"
    echo ""
    echo -e "  ${YELLOW}To add a server to monitor, run this on the target server:${NC}"
    echo ""
    echo -e "  ${WHITE}curl -fsSL http://$LOCAL_IP:$DEFAULT_PORT/agent.sh | bash -s -- \\${NC}"
    echo -e "  ${WHITE}  --server http://$LOCAL_IP:$DEFAULT_PORT \\${NC}"
    echo -e "  ${WHITE}  --name \"My Server\" \\${NC}"
    echo -e "  ${WHITE}  --token \"your-token\"${NC}"
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
    echo -e "${YELLOW}Uninstalling xProb...${NC}"
    
    systemctl stop $SERVICE_NAME 2>/dev/null || true
    systemctl disable $SERVICE_NAME 2>/dev/null || true
    rm -f /etc/systemd/system/$SERVICE_NAME.service
    systemctl daemon-reload
    
    read -p "Remove all data? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$INSTALL_DIR"
        success "All data removed"
    else
        rm -f "$INSTALL_DIR/xprob-server"
        rm -rf "$INSTALL_DIR/web"
        success "Binary removed, data preserved"
    fi
    
    success "xProb uninstalled"
    exit 0
}

# Main installation flow
main() {
    print_banner
    
    # Handle uninstall flag
    if [ "$1" = "uninstall" ] || [ "$1" = "--uninstall" ]; then
        check_root
        uninstall
    fi
    
    check_root
    detect_system
    install_deps
    setup_dirs
    install_binary
    install_web
    generate_config
    create_service
    configure_firewall
    print_complete
}

main "$@"

