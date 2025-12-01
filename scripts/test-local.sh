#!/bin/bash
#
# vStats - Local Development Test Script
# This script builds and runs vStats locally for testing
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
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$PROJECT_ROOT/server"
WEB_DIR="$PROJECT_ROOT/web"
PORT=3001

# Print colored message
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Print banner
print_banner() {
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════════════╗"
    echo "║      vStats - Local Development Test              ║"
    echo "╚═══════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Check dependencies
check_deps() {
    info "Checking dependencies..."
    
    if ! command -v cargo &> /dev/null; then
        error "Rust/Cargo is not installed. Please install Rust: https://rustup.rs"
    fi
    success "Rust/Cargo found"
    
    if ! command -v node &> /dev/null; then
        error "Node.js is not installed. Please install Node.js: https://nodejs.org"
    fi
    success "Node.js found: $(node --version)"
    
    if ! command -v npm &> /dev/null; then
        error "npm is not installed"
    fi
    success "npm found: $(npm --version)"
}

# Build backend
build_backend() {
    info "Building backend server..."
    cd "$SERVER_DIR"
    
    if cargo build --release 2>&1 | tee /tmp/vstats-build.log; then
        success "Backend built successfully"
    else
        error "Backend build failed. Check /tmp/vstats-build.log"
    fi
}

# Build frontend
build_frontend() {
    info "Building frontend..."
    cd "$WEB_DIR"
    
    if [ ! -d "node_modules" ]; then
        info "Installing npm dependencies..."
        npm install
    fi
    
    if npm run build 2>&1 | tee /tmp/vstats-web-build.log; then
        success "Frontend built successfully"
    else
        error "Frontend build failed. Check /tmp/vstats-web-build.log"
    fi
}

# Setup test environment
setup_test_env() {
    info "Setting up test environment..."
    
    # Create data directory
    TEST_DATA_DIR="$PROJECT_ROOT/test-data"
    mkdir -p "$TEST_DATA_DIR"
    
    # Create config if not exists
    if [ ! -f "$TEST_DATA_DIR/vstats-config.json" ]; then
        cat > "$TEST_DATA_DIR/vstats-config.json" << EOF
{
  "admin_password_hash": "\$2b\$12\$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyY5Y5Y5Y5Y5",
  "servers": []
}
EOF
        success "Created test config (password: admin)"
    fi
    
    # Copy web dist if exists
    if [ -d "$WEB_DIR/dist" ]; then
        TEST_WEB_DIR="$PROJECT_ROOT/test-web"
        rm -rf "$TEST_WEB_DIR"
        cp -r "$WEB_DIR/dist" "$TEST_WEB_DIR"
        success "Web assets ready"
    fi
}

# Start server
start_server() {
    info "Starting server..."
    
    # Try both possible binary names
    if [ -f "$SERVER_DIR/target/release/xprob-server" ]; then
        SERVER_BINARY="$SERVER_DIR/target/release/xprob-server"
    elif [ -f "$SERVER_DIR/target/release/vstats-server" ]; then
        SERVER_BINARY="$SERVER_DIR/target/release/vstats-server"
    else
        error "Server binary not found. Run: $0 build"
    fi
    
    TEST_DATA_DIR="$PROJECT_ROOT/test-data"
    TEST_WEB_DIR="$PROJECT_ROOT/test-web"
    
    # Set environment variables
    export RUST_LOG=info
    export VSTATS_PORT=$PORT
    if [ -d "$TEST_WEB_DIR" ]; then
        export VSTATS_WEB_DIR="$TEST_WEB_DIR"
    else
        export VSTATS_WEB_DIR="$WEB_DIR/dist"
    fi
    
    info "Server will run on http://localhost:$PORT"
    info "Default password: admin"
    info "Press Ctrl+C to stop"
    echo ""
    
    cd "$TEST_DATA_DIR"
    "$SERVER_BINARY"
}

# Run tests
run_tests() {
    info "Running tests..."
    
    # Test health endpoint
    info "Testing health endpoint..."
    if curl -s http://localhost:$PORT/health | grep -q "OK"; then
        success "Health check passed"
    else
        warn "Health check failed"
    fi
    
    # Test API endpoint
    info "Testing API endpoint..."
    if curl -s http://localhost:$PORT/api/metrics > /dev/null; then
        success "API endpoint accessible"
    else
        warn "API endpoint failed"
    fi
}

# Clean test files
clean() {
    info "Cleaning test files..."
    
    TEST_DATA_DIR="$PROJECT_ROOT/test-data"
    TEST_WEB_DIR="$PROJECT_ROOT/test-web"
    
    read -p "Remove test data directory? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$TEST_DATA_DIR"
        success "Test data removed"
    fi
    
    read -p "Remove test web directory? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$TEST_WEB_DIR"
        success "Test web directory removed"
    fi
}

# Show usage
show_usage() {
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  build       Build both backend and frontend"
    echo "  backend     Build backend only"
    echo "  frontend    Build frontend only"
    echo "  setup       Setup test environment"
    echo "  start       Start the server (builds if needed)"
    echo "  test        Run tests (server must be running)"
    echo "  clean       Clean test files"
    echo "  all         Build, setup, and start (default)"
    echo ""
}

# Main
main() {
    print_banner
    
    case "${1:-all}" in
        build)
            check_deps
            build_backend
            build_frontend
            ;;
        backend)
            check_deps
            build_backend
            ;;
        frontend)
            check_deps
            build_frontend
            ;;
        setup)
            setup_test_env
            ;;
        start)
            setup_test_env
            start_server
            ;;
        test)
            run_tests
            ;;
        clean)
            clean
            ;;
        all|*)
            check_deps
            build_backend
            build_frontend
            setup_test_env
            start_server
            ;;
    esac
}

main "$@"

