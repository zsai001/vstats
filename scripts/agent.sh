#!/bin/bash
#
# xProb Agent - Server Monitoring Agent
# One-click installation script for monitored servers
#
# Usage:
#   curl -fsSL http://dashboard-ip:3001/agent.sh | bash -s -- \
#     --server http://dashboard-ip:3001 \
#     --name "My Server" \
#     --token "your-token"
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
INSTALL_DIR="/opt/xprob-agent"
SERVICE_NAME="xprob-agent"
DEFAULT_PORT=3002

# Print banner
print_banner() {
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════╗"
    echo "║         xProb Agent Installation          ║"
    echo "║         Server Monitoring Probe           ║"
    echo "╚═══════════════════════════════════════════╝"
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
            --port)
                AGENT_PORT="$2"
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
                error "Unknown option: $1"
                ;;
        esac
    done
    
    # Set defaults
    AGENT_PORT=${AGENT_PORT:-$DEFAULT_PORT}
    SERVER_NAME=${SERVER_NAME:-$(hostname)}
    LOCATION=${LOCATION:-"Unknown"}
    PROVIDER=${PROVIDER:-"Unknown"}
}

show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --server, -s URL     Dashboard server URL (required)"
    echo "  --name, -n NAME      Server display name (default: hostname)"
    echo "  --token, -t TOKEN    Authentication token (required)"
    echo "  --location, -l LOC   Server location (e.g., 'US', 'CN')"
    echo "  --provider, -p NAME  Hosting provider (e.g., 'Vultr', 'AWS')"
    echo "  --port PORT          Agent listen port (default: 3002)"
    echo "  --uninstall          Uninstall agent"
    echo "  --help, -h           Show this help"
    echo ""
    echo "Example:"
    echo "  curl -fsSL http://dashboard:3001/agent.sh | bash -s -- \\"
    echo "    --server http://dashboard:3001 \\"
    echo "    --name 'US-Server-1' \\"
    echo "    --token 'abc123' \\"
    echo "    --location 'US' \\"
    echo "    --provider 'Vultr'"
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
        *) error "Unsupported architecture: $ARCH" ;;
    esac
    
    case "$OS" in
        linux) OS="linux" ;;
        darwin) OS="darwin" ;;
        *) error "Unsupported OS: $OS" ;;
    esac
    
    info "Detected: $OS-$ARCH"
}

# Setup directories
setup_dirs() {
    info "Setting up directories..."
    mkdir -p "$INSTALL_DIR"
}

# Download agent binary
download_agent() {
    info "Downloading xProb agent..."
    
    # Download from dashboard server
    if [ -n "$DASHBOARD_URL" ]; then
        DOWNLOAD_URL="$DASHBOARD_URL/downloads/xprob-agent-$OS-$ARCH"
        
        if curl -fsSL "$DOWNLOAD_URL" -o "$INSTALL_DIR/xprob-agent" 2>/dev/null; then
            chmod +x "$INSTALL_DIR/xprob-agent"
            success "Downloaded agent binary"
            return 0
        fi
    fi
    
    # Fallback: check if local binary exists
    if [ -f "./server/target/release/xprob-server" ]; then
        cp "./server/target/release/xprob-server" "$INSTALL_DIR/xprob-agent"
        chmod +x "$INSTALL_DIR/xprob-agent"
        success "Copied local binary"
        return 0
    fi
    
    warn "Could not download binary. Using built-in minimal agent..."
    create_minimal_agent
}

# Create a minimal shell-based agent (fallback)
create_minimal_agent() {
    info "Creating minimal shell agent..."
    
    cat > "$INSTALL_DIR/xprob-agent.sh" << 'AGENT_SCRIPT'
#!/bin/bash
# Minimal xProb agent - collects and reports system metrics

DASHBOARD_URL="$1"
AGENT_PORT="$2"

collect_metrics() {
    HOSTNAME=$(hostname)
    OS_NAME=$(uname -s)
    OS_VERSION=$(uname -r)
    ARCH=$(uname -m)
    UPTIME=$(cat /proc/uptime 2>/dev/null | cut -d' ' -f1 | cut -d'.' -f1 || echo "0")
    
    # CPU
    CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1 2>/dev/null || echo "0")
    CPU_CORES=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo "1")
    
    # Memory
    if [ -f /proc/meminfo ]; then
        MEM_TOTAL=$(grep MemTotal /proc/meminfo | awk '{print $2 * 1024}')
        MEM_AVAILABLE=$(grep MemAvailable /proc/meminfo | awk '{print $2 * 1024}')
        MEM_USED=$((MEM_TOTAL - MEM_AVAILABLE))
    else
        MEM_TOTAL=$(sysctl -n hw.memsize 2>/dev/null || echo "0")
        MEM_USED=$((MEM_TOTAL / 2))
        MEM_AVAILABLE=$((MEM_TOTAL / 2))
    fi
    
    # Disk
    DISK_INFO=$(df -B1 / 2>/dev/null | tail -1)
    DISK_TOTAL=$(echo "$DISK_INFO" | awk '{print $2}')
    DISK_USED=$(echo "$DISK_INFO" | awk '{print $3}')
    DISK_AVAIL=$(echo "$DISK_INFO" | awk '{print $4}')
    
    # Network
    if [ -d /sys/class/net ]; then
        NET_RX=0
        NET_TX=0
        for iface in /sys/class/net/*/statistics; do
            if [ -f "$iface/rx_bytes" ]; then
                NET_RX=$((NET_RX + $(cat "$iface/rx_bytes")))
                NET_TX=$((NET_TX + $(cat "$iface/tx_bytes")))
            fi
        done
    else
        NET_RX=0
        NET_TX=0
    fi
    
    # Load average
    if [ -f /proc/loadavg ]; then
        LOAD=$(cat /proc/loadavg)
        LOAD_1=$(echo "$LOAD" | cut -d' ' -f1)
        LOAD_5=$(echo "$LOAD" | cut -d' ' -f2)
        LOAD_15=$(echo "$LOAD" | cut -d' ' -f3)
    else
        LOAD_1="0.0"
        LOAD_5="0.0"
        LOAD_15="0.0"
    fi
    
    # Output JSON
    cat << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "hostname": "$HOSTNAME",
  "os": {
    "name": "$OS_NAME",
    "version": "$OS_VERSION",
    "kernel": "$OS_VERSION",
    "arch": "$ARCH"
  },
  "cpu": {
    "brand": "Unknown",
    "cores": $CPU_CORES,
    "usage": $CPU_USAGE,
    "frequency": 0,
    "per_core": []
  },
  "memory": {
    "total": $MEM_TOTAL,
    "used": $MEM_USED,
    "available": $MEM_AVAILABLE,
    "swap_total": 0,
    "swap_used": 0,
    "usage_percent": $(echo "scale=2; $MEM_USED * 100 / $MEM_TOTAL" | bc 2>/dev/null || echo "0")
  },
  "disks": [{
    "name": "/",
    "mount_point": "/",
    "fs_type": "ext4",
    "total": $DISK_TOTAL,
    "used": $DISK_USED,
    "available": $DISK_AVAIL,
    "usage_percent": $(echo "scale=2; $DISK_USED * 100 / $DISK_TOTAL" | bc 2>/dev/null || echo "0")
  }],
  "network": {
    "interfaces": [],
    "total_rx": $NET_RX,
    "total_tx": $NET_TX
  },
  "uptime": $UPTIME,
  "load_average": {
    "one": $LOAD_1,
    "five": $LOAD_5,
    "fifteen": $LOAD_15
  }
}
EOF
}

# Start simple HTTP server with netcat
start_server() {
    info "Starting agent on port $AGENT_PORT..."
    
    while true; do
        METRICS=$(collect_metrics)
        RESPONSE="HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: ${#METRICS}\r\n\r\n$METRICS"
        echo -e "$RESPONSE" | nc -l -p $AGENT_PORT -q 1 2>/dev/null || \
        echo -e "$RESPONSE" | nc -l $AGENT_PORT 2>/dev/null || \
        sleep 1
    done
}

start_server
AGENT_SCRIPT

    chmod +x "$INSTALL_DIR/xprob-agent.sh"
    
    # Create wrapper
    cat > "$INSTALL_DIR/xprob-agent" << EOF
#!/bin/bash
exec "$INSTALL_DIR/xprob-agent.sh" "$DASHBOARD_URL" "$AGENT_PORT"
EOF
    chmod +x "$INSTALL_DIR/xprob-agent"
}

# Generate agent config
generate_config() {
    info "Generating configuration..."
    
    cat > "$INSTALL_DIR/config.json" << EOF
{
  "dashboard_url": "$DASHBOARD_URL",
  "server_name": "$SERVER_NAME",
  "location": "$LOCATION",
  "provider": "$PROVIDER",
  "port": $AGENT_PORT
}
EOF
}

# Register with dashboard
register_with_dashboard() {
    if [ -z "$DASHBOARD_URL" ] || [ -z "$AUTH_TOKEN" ]; then
        warn "Skipping dashboard registration (no URL or token provided)"
        return 0
    fi
    
    info "Registering with dashboard..."
    
    LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || curl -s ifconfig.me 2>/dev/null || echo "127.0.0.1")
    
    RESPONSE=$(curl -s -X POST "$DASHBOARD_URL/api/servers" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        -d "{
            \"name\": \"$SERVER_NAME\",
            \"url\": \"ws://$LOCAL_IP:$AGENT_PORT/ws\",
            \"location\": \"$LOCATION\",
            \"provider\": \"$PROVIDER\"
        }" 2>/dev/null)
    
    if echo "$RESPONSE" | grep -q '"id"'; then
        success "Registered with dashboard"
        SERVER_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
        echo "$SERVER_ID" > "$INSTALL_DIR/server_id"
    else
        warn "Could not register with dashboard. You can add manually from the settings page."
        echo "Response: $RESPONSE"
    fi
}

# Create systemd service
create_service() {
    info "Creating systemd service..."
    
    cat > /etc/systemd/system/$SERVICE_NAME.service << EOF
[Unit]
Description=xProb Monitoring Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/xprob-agent
Restart=always
RestartSec=5
Environment=RUST_LOG=info
Environment=XPROB_PORT=$AGENT_PORT

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
        ufw allow $AGENT_PORT/tcp
        success "UFW rule added"
    elif command -v firewall-cmd &> /dev/null; then
        firewall-cmd --permanent --add-port=$AGENT_PORT/tcp
        firewall-cmd --reload
        success "Firewalld rule added"
    else
        warn "No firewall detected. Please manually open port $AGENT_PORT"
    fi
}

# Print completion message
print_complete() {
    LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "your-server-ip")
    
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           xProb Agent Installation Complete!              ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${CYAN}Agent URL:${NC}     ws://$LOCAL_IP:$AGENT_PORT/ws"
    echo -e "  ${CYAN}Server Name:${NC}   $SERVER_NAME"
    echo -e "  ${CYAN}Location:${NC}      $LOCATION"
    echo -e "  ${CYAN}Provider:${NC}      $PROVIDER"
    echo ""
    
    if [ -n "$DASHBOARD_URL" ]; then
        echo -e "  ${CYAN}Dashboard:${NC}     $DASHBOARD_URL"
    fi
    
    echo ""
    echo -e "  ${CYAN}Service Commands:${NC}"
    echo "    systemctl status $SERVICE_NAME   # Check status"
    echo "    systemctl restart $SERVICE_NAME  # Restart"
    echo "    systemctl stop $SERVICE_NAME     # Stop"
    echo "    journalctl -u $SERVICE_NAME -f   # View logs"
    echo ""
    
    if [ -z "$DASHBOARD_URL" ]; then
        echo -e "  ${YELLOW}To add this server to your dashboard:${NC}"
        echo "    1. Go to your dashboard Settings page"
        echo "    2. Click 'Add Server'"
        echo "    3. Enter URL: ws://$LOCAL_IP:$AGENT_PORT/ws"
        echo ""
    fi
}

# Uninstall function
uninstall() {
    echo -e "${YELLOW}Uninstalling xProb Agent...${NC}"
    
    systemctl stop $SERVICE_NAME 2>/dev/null || true
    systemctl disable $SERVICE_NAME 2>/dev/null || true
    rm -f /etc/systemd/system/$SERVICE_NAME.service
    systemctl daemon-reload
    rm -rf "$INSTALL_DIR"
    
    success "xProb Agent uninstalled"
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
    download_agent
    generate_config
    create_service
    configure_firewall
    register_with_dashboard
    print_complete
}

main "$@"

