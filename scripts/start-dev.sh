#!/bin/bash
#
# Development server start script
# Rebuilds frontend and backend, then starts the server
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$PROJECT_ROOT/server"
AGENT_DIR="$PROJECT_ROOT/agent"
WEB_DIR="$PROJECT_ROOT/web"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}       vStats Development Server        ${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""

# Build frontend
echo -e "${YELLOW}[1/4]${NC} Building frontend..."
cd "$WEB_DIR"
if [ ! -d "node_modules" ]; then
    npm install
fi
npm run build
echo -e "${GREEN}✓ Frontend built${NC}"
echo ""

# Build backend
echo -e "${YELLOW}[2/4]${NC} Building backend..."
cd "$SERVER_DIR"
cargo build --release
echo -e "${GREEN}✓ Backend built${NC}"
echo ""

# Build agent
echo -e "${YELLOW}[3/4]${NC} Building agent..."
cd "$AGENT_DIR"
cargo build --release
echo -e "${GREEN}✓ Agent built${NC}"
echo ""

# Set environment variables
export RUST_LOG=info
export VSTATS_PORT=3001
export VSTATS_WEB_DIR="$WEB_DIR/dist"

SERVER_BINARY="$SERVER_DIR/target/release/vstats-server"

# Kill existing vstats-server processes
echo -e "${YELLOW}[0/4]${NC} Stopping existing services..."
if pgrep -f "vstats-server" > /dev/null 2>&1; then
    echo -e "${YELLOW}  Found running vstats-server processes, stopping...${NC}"
    pkill -f "vstats-server" || true
    sleep 1
    # Force kill if still running
    if pgrep -f "vstats-server" > /dev/null 2>&1; then
        pkill -9 -f "vstats-server" || true
        sleep 0.5
    fi
    echo -e "${GREEN}✓ Old services stopped${NC}"
else
    echo -e "${GREEN}✓ No existing services found${NC}"
fi
echo ""

# Reset password to get a fresh one for development
echo -e "${YELLOW}[4/4]${NC} Resetting admin password..."
cd "$SERVER_DIR"
PASSWORD_OUTPUT=$("$SERVER_BINARY" --reset-password 2>&1)
# Extract password from output (format: "New admin password: {password}")
ADMIN_PASSWORD=$(echo "$PASSWORD_OUTPUT" | grep "New admin password:" | sed -E 's/.*New admin password: +([^ ]+).*/\1/' | tr -d ' ')
if [ -z "$ADMIN_PASSWORD" ]; then
    ADMIN_PASSWORD="admin"
fi
echo -e "${GREEN}✓ Password reset${NC}"
echo ""

echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${GREEN}Server: http://localhost:3001${NC}"
echo -e "${GREEN}Web:    $VSTATS_WEB_DIR${NC}"
echo -e "${GREEN}Pass:   ${ADMIN_PASSWORD}${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""

# Change to server directory and run
cd "$SERVER_DIR"
"$SERVER_BINARY"
