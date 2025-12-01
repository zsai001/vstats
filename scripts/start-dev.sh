#!/bin/bash
#
# Quick development server start script
# This ensures the web directory is found correctly
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$PROJECT_ROOT/server"
WEB_DIR="$PROJECT_ROOT/web"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Starting vStats development server...${NC}"

# Check if web/dist exists
if [ ! -d "$WEB_DIR/dist" ]; then
    echo -e "${BLUE}Building frontend...${NC}"
    cd "$WEB_DIR"
    npm install
    npm run build
fi

# Check if server binary exists
if [ ! -f "$SERVER_DIR/target/release/xprob-server" ] && [ ! -f "$SERVER_DIR/target/debug/xprob-server" ]; then
    echo -e "${BLUE}Building server...${NC}"
    cd "$SERVER_DIR"
    cargo build --release
fi

# Set environment variables
export RUST_LOG=info
export VSTATS_PORT=3001
export VSTATS_WEB_DIR="$WEB_DIR/dist"

# Find binary
if [ -f "$SERVER_DIR/target/release/xprob-server" ]; then
    SERVER_BINARY="$SERVER_DIR/target/release/xprob-server"
elif [ -f "$SERVER_DIR/target/debug/xprob-server" ]; then
    SERVER_BINARY="$SERVER_DIR/target/debug/xprob-server"
else
    echo "Error: Server binary not found"
    exit 1
fi

echo -e "${GREEN}Server starting on http://localhost:3001${NC}"
echo -e "${GREEN}Web directory: $VSTATS_WEB_DIR${NC}"
echo -e "${GREEN}Default password: admin${NC}"
echo ""

# Change to server directory and run
cd "$SERVER_DIR"
"$SERVER_BINARY"

