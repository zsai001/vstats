#!/bin/bash
#
# vStats Agent - Server Monitoring Probe (Push Model)
# Agent connects to dashboard and pushes metrics
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
INSTALL_DIR="/opt/vstats-agent"
SERVICE_NAME="vstats-agent"
CONFIG_FILE="$INSTALL_DIR/config.json"
GITHUB_REPO="zsai001/vstats"
GITHUB_API="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"
GITHUB_DOWNLOAD="https://github.com/${GITHUB_REPO}/releases/download"

# Print banner
print_banner() {
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════════════╗"
    echo "║        vStats Agent - Monitoring Probe            ║"
    echo "║          Push Model - One-Click Install           ║"
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
    LOCATION=${LOCATION:-"Unknown"}
    PROVIDER=${PROVIDER:-"Unknown"}
}

show_help() {
    echo "vStats Agent Installation Script (Push Model)"
    echo ""
    echo "The agent connects to your dashboard and pushes metrics."
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
    echo "  --upgrade            Upgrade to latest version"
    echo "  --help, -h           Show this help"
    echo ""
    echo "Example (auto-register):"
    echo "  curl -fsSL https://vstats.zsoft.cc/agent.sh | sudo bash -s -- \\"
    echo "    --server http://dashboard:3001 \\"
    echo "    --name 'US-Server-1' \\"
    echo "    --token 'admin-jwt-token' \\"
    echo "    --location 'US' \\"
    echo "    --provider 'Vultr'"
    echo ""
    echo "Example (pre-registered):"
    echo "  curl -fsSL https://vstats.zsoft.cc/agent.sh | sudo bash -s -- \\"
    echo "    --server http://dashboard:3001 \\"
    echo "    --server-id 'abc-123' \\"
    echo "    --agent-token 'agent-token-xyz'"
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

# Setup directories
setup_dirs() {
    info "Setting up directories..."
    mkdir -p "$INSTALL_DIR"
}

# Check for required tools
check_dependencies() {
    info "Checking dependencies..."
    
    # Check for websocat (WebSocket client)
    if ! command -v websocat &> /dev/null; then
        warn "websocat not found, will use shell-based agent"
        USE_SHELL_AGENT=true
    fi
    
    # Check for jq
    if ! command -v jq &> /dev/null; then
        warn "jq not found, installing..."
        if command -v apt-get &> /dev/null; then
            apt-get update && apt-get install -y jq
        elif command -v yum &> /dev/null; then
            yum install -y jq
        elif command -v apk &> /dev/null; then
            apk add jq
        else
            warn "Could not install jq, some features may be limited"
        fi
    fi
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

# Generate agent config
generate_config() {
    info "Generating configuration..."
    
    cat > "$CONFIG_FILE" << EOF
{
  "dashboard_url": "$DASHBOARD_URL",
  "server_id": "$SERVER_ID",
  "agent_token": "$AGENT_TOKEN",
  "server_name": "$SERVER_NAME",
  "location": "$LOCATION",
  "provider": "$PROVIDER"
}
EOF
    chmod 600 "$CONFIG_FILE"
}

# Create shell-based agent that pushes to dashboard
create_shell_agent() {
    info "Creating shell-based agent..."
    
    cat > "$INSTALL_DIR/vstats-agent.sh" << 'AGENT_SCRIPT'
#!/bin/bash
# vStats Shell Agent - Push metrics to dashboard via WebSocket

CONFIG_FILE="/opt/vstats-agent/config.json"
RECONNECT_DELAY=5
MAX_RECONNECT_DELAY=60

# Load config
load_config() {
    if [ -f "$CONFIG_FILE" ]; then
        DASHBOARD_URL=$(grep -o '"dashboard_url":"[^"]*"' "$CONFIG_FILE" | cut -d'"' -f4)
        SERVER_ID=$(grep -o '"server_id":"[^"]*"' "$CONFIG_FILE" | cut -d'"' -f4)
        AGENT_TOKEN=$(grep -o '"agent_token":"[^"]*"' "$CONFIG_FILE" | cut -d'"' -f4)
        return 0
    else
        echo "[ERROR] Config file not found: $CONFIG_FILE"
        return 1
    fi
}

if ! load_config; then
    exit 1
fi

# Convert HTTP URL to WebSocket URL
get_ws_url() {
    echo "$DASHBOARD_URL" | sed 's|^http://|ws://|; s|^https://|wss://|'
}

WS_URL="$(get_ws_url)/ws/agent"

echo "[INFO] Dashboard URL: $DASHBOARD_URL"
echo "[INFO] WebSocket URL: $WS_URL"
echo "[INFO] Server ID: $SERVER_ID"

collect_metrics() {
    HOSTNAME=$(hostname)
    OS_NAME=$(uname -s)
    OS_VERSION=$(uname -r)
    ARCH=$(uname -m)
    UPTIME=$(cat /proc/uptime 2>/dev/null | cut -d' ' -f1 | cut -d'.' -f1 || echo "0")
    
    # CPU - more robust parsing
    CPU_USAGE=$(top -bn1 2>/dev/null | grep -E "^%?Cpu|^CPU" | head -1 | sed 's/,/./g' | awk '{
        for(i=1;i<=NF;i++) {
            if($i ~ /^[0-9.]+$/ && $(i+1) ~ /us|user/) { print $i; exit }
            if($i ~ /us|user/ && $(i-1) ~ /^[0-9.]+$/) { print $(i-1); exit }
        }
        # Fallback: try to find first number
        for(i=1;i<=NF;i++) {
            if($i ~ /^[0-9.]+$/) { print $i; exit }
        }
    }' || echo "0")
    
    # Ensure CPU_USAGE is a valid number
    if [ -z "$CPU_USAGE" ] || ! echo "$CPU_USAGE" | grep -qE '^[0-9.]+$'; then
        CPU_USAGE="0"
    fi
    
    CPU_CORES=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo "1")
    CPU_BRAND=$(cat /proc/cpuinfo 2>/dev/null | grep "model name" | head -1 | cut -d':' -f2 | sed 's/^ //; s/"/\\"/g' || echo "Unknown")
    
    # Memory
    if [ -f /proc/meminfo ]; then
        MEM_TOTAL=$(awk '/MemTotal/ {print $2 * 1024}' /proc/meminfo)
        MEM_AVAILABLE=$(awk '/MemAvailable/ {print $2 * 1024}' /proc/meminfo)
        MEM_USED=$((MEM_TOTAL - MEM_AVAILABLE))
        MEM_PERCENT=$(awk "BEGIN {printf \"%.1f\", ($MEM_USED / $MEM_TOTAL) * 100}")
        SWAP_TOTAL=$(awk '/SwapTotal/ {print $2 * 1024}' /proc/meminfo)
        SWAP_FREE=$(awk '/SwapFree/ {print $2 * 1024}' /proc/meminfo)
        SWAP_USED=$((SWAP_TOTAL - SWAP_FREE))
    else
        MEM_TOTAL=$(sysctl -n hw.memsize 2>/dev/null || echo "0")
        MEM_USED=$((MEM_TOTAL / 2))
        MEM_AVAILABLE=$((MEM_TOTAL / 2))
        MEM_PERCENT="50.0"
        SWAP_TOTAL=0
        SWAP_USED=0
    fi
    
    # Disk
    DISK_INFO=$(df -B1 / 2>/dev/null | tail -1)
    DISK_TOTAL=$(echo "$DISK_INFO" | awk '{print $2}')
    DISK_USED=$(echo "$DISK_INFO" | awk '{print $3}')
    DISK_AVAIL=$(echo "$DISK_INFO" | awk '{print $4}')
    DISK_PERCENT=$(echo "$DISK_INFO" | awk '{gsub(/%/,""); print $5}')
    
    # Network
    NET_RX=0
    NET_TX=0
    NET_INTERFACES="[]"
    if [ -d /sys/class/net ]; then
        IFACE_JSON=""
        for iface_dir in /sys/class/net/*/statistics; do
            iface=$(basename $(dirname "$iface_dir"))
            if [ -f "$iface_dir/rx_bytes" ]; then
                rx=$(cat "$iface_dir/rx_bytes")
                tx=$(cat "$iface_dir/tx_bytes")
                NET_RX=$((NET_RX + rx))
                NET_TX=$((NET_TX + tx))
                if [ -n "$IFACE_JSON" ]; then
                    IFACE_JSON="$IFACE_JSON,"
                fi
                IFACE_JSON="$IFACE_JSON{\"name\":\"$iface\",\"rx_bytes\":$rx,\"tx_bytes\":$tx,\"rx_packets\":0,\"tx_packets\":0}"
            fi
        done
        NET_INTERFACES="[$IFACE_JSON]"
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
    
    # Per-core CPU usage (simplified)
    PER_CORE="[]"
    if [ -f /proc/stat ]; then
        CORES=$(grep -c "^cpu[0-9]" /proc/stat 2>/dev/null || echo "0")
        if [ "$CORES" -gt 0 ]; then
            PER_CORE_JSON=""
            for i in $(seq 0 $((CORES - 1))); do
                if [ -n "$PER_CORE_JSON" ]; then
                    PER_CORE_JSON="$PER_CORE_JSON,"
                fi
                # Use same CPU usage for simplicity
                PER_CORE_JSON="$PER_CORE_JSON${CPU_USAGE:-0}"
            done
            PER_CORE="[$PER_CORE_JSON]"
        fi
    fi
    
    # Output JSON (compact, single line for WebSocket)
    printf '{"timestamp":"%s","hostname":"%s","os":{"name":"%s","version":"%s","kernel":"%s","arch":"%s"},"cpu":{"brand":"%s","cores":%s,"usage":%s,"frequency":0,"per_core":%s},"memory":{"total":%s,"used":%s,"available":%s,"swap_total":%s,"swap_used":%s,"usage_percent":%s},"disks":[{"name":"/","mount_point":"/","fs_type":"ext4","total":%s,"used":%s,"available":%s,"usage_percent":%s}],"network":{"interfaces":%s,"total_rx":%s,"total_tx":%s},"uptime":%s,"load_average":{"one":%s,"five":%s,"fifteen":%s}}' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        "$HOSTNAME" \
        "$OS_NAME" \
        "$OS_VERSION" \
        "$OS_VERSION" \
        "$ARCH" \
        "$CPU_BRAND" \
        "${CPU_CORES:-1}" \
        "${CPU_USAGE:-0}" \
        "$PER_CORE" \
        "${MEM_TOTAL:-0}" \
        "${MEM_USED:-0}" \
        "${MEM_AVAILABLE:-0}" \
        "${SWAP_TOTAL:-0}" \
        "${SWAP_USED:-0}" \
        "${MEM_PERCENT:-0}" \
        "${DISK_TOTAL:-0}" \
        "${DISK_USED:-0}" \
        "${DISK_AVAIL:-0}" \
        "${DISK_PERCENT:-0}" \
        "$NET_INTERFACES" \
        "$NET_RX" \
        "$NET_TX" \
        "${UPTIME:-0}" \
        "${LOAD_1:-0}" \
        "${LOAD_5:-0}" \
        "${LOAD_15:-0}"
}

# WebSocket client using websocat or curl
send_to_dashboard() {
    if command -v websocat &> /dev/null; then
        websocat_agent_loop
    else
        curl_agent
    fi
}

# Agent using websocat with reconnection loop
websocat_agent_loop() {
    local delay=$RECONNECT_DELAY
    
    while true; do
        echo "[INFO] Connecting to WebSocket at $WS_URL..."
        websocat_agent
        local exit_code=$?
        
        echo "[WARN] WebSocket connection closed (exit code: $exit_code)"
        echo "[INFO] Reconnecting in ${delay}s..."
        sleep $delay
        
        # Exponential backoff with max delay
        delay=$((delay * 2))
        if [ $delay -gt $MAX_RECONNECT_DELAY ]; then
            delay=$MAX_RECONNECT_DELAY
        fi
        
        # Reload config in case it changed
        load_config
        WS_URL="$(get_ws_url)/ws/agent"
    done
}

# Single WebSocket connection attempt
websocat_agent() {
    echo "[INFO] Starting WebSocket session..."
    
    # Create a named pipe for bidirectional communication
    PIPE_DIR=$(mktemp -d)
    SEND_PIPE="$PIPE_DIR/send"
    mkfifo "$SEND_PIPE"
    
    # Cleanup on exit
    cleanup() {
        rm -rf "$PIPE_DIR" 2>/dev/null
    }
    trap cleanup EXIT
    
    # Start websocat in background, reading from pipe
    websocat -t "$WS_URL" < "$SEND_PIPE" 2>&1 &
    WS_PID=$!
    
    # Open pipe for writing (keep it open)
    exec 3>"$SEND_PIPE"
    
    # Send auth message
    echo "[INFO] Sending auth message..."
    printf '{"type":"auth","server_id":"%s","token":"%s"}\n' "$SERVER_ID" "$AGENT_TOKEN" >&3
    
    # Wait a moment for auth response
    sleep 2
    
    # Check if websocat is still running
    if ! kill -0 $WS_PID 2>/dev/null; then
        echo "[ERROR] WebSocket connection failed - server may have rejected authentication"
        exec 3>&-
        wait $WS_PID 2>/dev/null
        return 1
    fi
    
    echo "[INFO] Connected! Sending metrics..."
    
    # Continuously send metrics
    while kill -0 $WS_PID 2>/dev/null; do
        METRICS=$(collect_metrics)
        if ! printf '{"type":"metrics","metrics":%s}\n' "$METRICS" >&3 2>/dev/null; then
            echo "[ERROR] Failed to send metrics - connection may be closed"
            break
        fi
        sleep 1
    done
    
    # Cleanup
    exec 3>&-
    wait $WS_PID 2>/dev/null
    return 1
}

# Fallback agent using curl (less reliable)
curl_agent() {
    echo "[INFO] Starting HTTP polling agent (websocat not available)..."
    echo "[WARN] Install websocat for better real-time updates"
    
    while true; do
        METRICS=$(collect_metrics)
        
        # Try to send metrics via HTTP POST (fallback)
        RESPONSE=$(curl -s -X POST "$DASHBOARD_URL/api/agent/metrics" \
            -H "Content-Type: application/json" \
            -H "X-Server-ID: $SERVER_ID" \
            -H "X-Agent-Token: $AGENT_TOKEN" \
            -d "$METRICS" 2>/dev/null)
        
        if [ -n "$RESPONSE" ]; then
            echo "[HTTP] Sent metrics, response: $RESPONSE"
        fi
        
        sleep 5
    done
}

echo "[INFO] Starting vStats agent..."
echo "[INFO] Press Ctrl+C to stop"
send_to_dashboard
AGENT_SCRIPT

    chmod +x "$INSTALL_DIR/vstats-agent.sh"
    
    success "Created shell agent"
}

# Install websocat if needed
install_websocat() {
    if command -v websocat &> /dev/null; then
        return 0
    fi
    
    info "Installing websocat for WebSocket support..."
    
    # Try to download pre-built binary
    WEBSOCAT_VERSION="1.11.0"
    case "$OS-$ARCH" in
        linux-x86_64)
            WEBSOCAT_URL="https://github.com/vi/websocat/releases/download/v${WEBSOCAT_VERSION}/websocat.x86_64-unknown-linux-musl"
            ;;
        linux-aarch64)
            WEBSOCAT_URL="https://github.com/vi/websocat/releases/download/v${WEBSOCAT_VERSION}/websocat.aarch64-unknown-linux-musl"
            ;;
        darwin-x86_64|darwin-aarch64)
            if command -v brew &> /dev/null; then
                brew install websocat && return 0
            fi
            warn "Could not install websocat on macOS without brew"
            return 1
            ;;
        *)
            warn "Could not find websocat binary for $OS-$ARCH"
            return 1
            ;;
    esac
    
    if [ -n "$WEBSOCAT_URL" ]; then
        curl -fsSL "$WEBSOCAT_URL" -o /usr/local/bin/websocat 2>/dev/null
        chmod +x /usr/local/bin/websocat
        success "websocat installed"
    fi
}

# Create systemd service
create_service() {
    info "Creating systemd service..."
    
    cat > /etc/systemd/system/$SERVICE_NAME.service << EOF
[Unit]
Description=vStats Monitoring Agent (Push Model)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=/bin/bash $INSTALL_DIR/vstats-agent.sh
Restart=always
RestartSec=10

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
    echo -e "  ${CYAN}Mode:${NC}          Push (agent connects to dashboard)"
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
    rm -rf "$INSTALL_DIR"
    
    success "vStats Agent uninstalled"
    exit 0
}

# Upgrade function
upgrade() {
    info "Upgrading vStats Agent..."
    
    # Re-download and recreate agent
    create_shell_agent
    
    systemctl restart $SERVICE_NAME 2>/dev/null || true
    
    success "Upgraded successfully"
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
    check_dependencies
    install_websocat
    setup_dirs
    register_with_dashboard
    generate_config
    create_shell_agent
    create_service
    
    print_complete
}

main "$@"
