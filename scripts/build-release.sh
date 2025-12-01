#!/bin/bash
#
# Build release binaries for vStats (agent and server)
# Creates portable static binaries using musl for Linux
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RELEASE_DIR="$PROJECT_ROOT/releases"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info() { echo -e "${CYAN}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Detect current platform
detect_platform() {
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)
    
    case "$ARCH" in
        x86_64|amd64) ARCH="x86_64" ;;
        aarch64|arm64) ARCH="aarch64" ;;
        *) error "Unsupported architecture: $ARCH" ;;
    esac
    
    info "Building on: $OS-$ARCH"
}

# Install required targets
install_targets() {
    info "Installing Rust targets..."
    
    # Always install musl target for portable Linux binaries
    if [[ "$OS" == "linux" ]]; then
        rustup target add x86_64-unknown-linux-musl 2>/dev/null || true
        rustup target add aarch64-unknown-linux-musl 2>/dev/null || true
    fi
    
    # macOS targets
    if [[ "$OS" == "darwin" ]]; then
        rustup target add x86_64-apple-darwin 2>/dev/null || true
        rustup target add aarch64-apple-darwin 2>/dev/null || true
    fi
    
    success "Targets installed"
}

# Install musl toolchain (Linux only)
install_musl_toolchain() {
    if [[ "$OS" != "linux" ]]; then
        return
    fi
    
    if ! command -v musl-gcc &> /dev/null; then
        warn "musl-gcc not found. Installing..."
        
        if command -v apt-get &> /dev/null; then
            sudo apt-get update && sudo apt-get install -y musl-tools
        elif command -v yum &> /dev/null; then
            sudo yum install -y musl-gcc musl-devel
        elif command -v dnf &> /dev/null; then
            sudo dnf install -y musl-gcc musl-devel
        elif command -v apk &> /dev/null; then
            # Alpine already has musl
            :
        elif command -v brew &> /dev/null; then
            brew install filosottile/musl-cross/musl-cross
        else
            error "Cannot install musl-gcc. Please install it manually."
        fi
    fi
    
    success "musl toolchain ready"
}

# Build agent
build_agent() {
    local target="$1"
    local output_name="$2"
    
    info "Building agent for $target..."
    
    cd "$PROJECT_ROOT/agent"
    
    if [[ "$target" == *"musl"* ]]; then
        # Static build with musl
        RUSTFLAGS="-C target-feature=+crt-static" cargo build --release --target "$target"
    else
        cargo build --release --target "$target"
    fi
    
    local binary_path="target/$target/release/vstats-agent"
    
    if [ -f "$binary_path" ]; then
        mkdir -p "$RELEASE_DIR"
        cp "$binary_path" "$RELEASE_DIR/$output_name"
        chmod +x "$RELEASE_DIR/$output_name"
        success "Built: $output_name ($(du -h "$RELEASE_DIR/$output_name" | cut -f1))"
    else
        error "Build failed for $target"
    fi
}

# Build server
build_server() {
    local target="$1"
    local output_name="$2"
    
    info "Building server for $target..."
    
    cd "$PROJECT_ROOT/server"
    
    if [[ "$target" == *"musl"* ]]; then
        # Static build with musl
        RUSTFLAGS="-C target-feature=+crt-static" cargo build --release --target "$target"
    else
        cargo build --release --target "$target"
    fi
    
    local binary_path="target/$target/release/xprob-server"
    
    if [ -f "$binary_path" ]; then
        mkdir -p "$RELEASE_DIR"
        cp "$binary_path" "$RELEASE_DIR/$output_name"
        chmod +x "$RELEASE_DIR/$output_name"
        success "Built: $output_name ($(du -h "$RELEASE_DIR/$output_name" | cut -f1))"
    else
        error "Build failed for $target"
    fi
}

# Build all targets for current platform
build_native() {
    detect_platform
    install_targets
    
    mkdir -p "$RELEASE_DIR"
    
    if [[ "$OS" == "linux" ]]; then
        install_musl_toolchain
        
        # Build musl (static) binaries - these work on ANY Linux
        if [[ "$ARCH" == "x86_64" ]]; then
            build_agent "x86_64-unknown-linux-musl" "vstats-agent-linux-x86_64-musl"
            build_server "x86_64-unknown-linux-musl" "vstats-server-linux-x86_64-musl"
        elif [[ "$ARCH" == "aarch64" ]]; then
            build_agent "aarch64-unknown-linux-musl" "vstats-agent-linux-aarch64-musl"
            build_server "aarch64-unknown-linux-musl" "vstats-server-linux-aarch64-musl"
        fi
        
    elif [[ "$OS" == "darwin" ]]; then
        # macOS builds
        if [[ "$ARCH" == "x86_64" ]]; then
            build_agent "x86_64-apple-darwin" "vstats-agent-darwin-x86_64"
            build_server "x86_64-apple-darwin" "vstats-server-darwin-x86_64"
        elif [[ "$ARCH" == "aarch64" ]]; then
            build_agent "aarch64-apple-darwin" "vstats-agent-darwin-aarch64"
            build_server "aarch64-apple-darwin" "vstats-server-darwin-aarch64"
        fi
        
        # Universal binary (if both archs available)
        # build_universal
    fi
}

# Build for specific target
build_target() {
    local target="$1"
    
    case "$target" in
        linux-x86_64|linux-x86_64-musl)
            install_targets
            build_agent "x86_64-unknown-linux-musl" "vstats-agent-linux-x86_64-musl"
            build_server "x86_64-unknown-linux-musl" "vstats-server-linux-x86_64-musl"
            ;;
        linux-aarch64|linux-aarch64-musl)
            install_targets
            build_agent "aarch64-unknown-linux-musl" "vstats-agent-linux-aarch64-musl"
            build_server "aarch64-unknown-linux-musl" "vstats-server-linux-aarch64-musl"
            ;;
        darwin-x86_64)
            install_targets
            build_agent "x86_64-apple-darwin" "vstats-agent-darwin-x86_64"
            build_server "x86_64-apple-darwin" "vstats-server-darwin-x86_64"
            ;;
        darwin-aarch64)
            install_targets
            build_agent "aarch64-apple-darwin" "vstats-agent-darwin-aarch64"
            build_server "aarch64-apple-darwin" "vstats-server-darwin-aarch64"
            ;;
        *)
            error "Unknown target: $target. Use: linux-x86_64, linux-aarch64, darwin-x86_64, darwin-aarch64"
            ;;
    esac
}

# Print usage
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --all           Build for all supported targets (requires cross-compilation)"
    echo "  --native        Build for current platform only (default)"
    echo "  --target TARGET Build for specific target"
    echo "  --agent-only    Build only the agent"
    echo "  --server-only   Build only the server"
    echo "  --clean         Clean build artifacts"
    echo ""
    echo "Targets:"
    echo "  linux-x86_64    Linux x86_64 (static musl)"
    echo "  linux-aarch64   Linux ARM64 (static musl)"
    echo "  darwin-x86_64   macOS Intel"
    echo "  darwin-aarch64  macOS Apple Silicon"
    echo ""
    echo "Output directory: $RELEASE_DIR"
}

# Clean build artifacts
clean() {
    info "Cleaning build artifacts..."
    rm -rf "$RELEASE_DIR"
    cd "$PROJECT_ROOT/agent" && cargo clean
    cd "$PROJECT_ROOT/server" && cargo clean
    success "Cleaned"
}

# Main
main() {
    detect_platform
    
    case "$1" in
        --help|-h)
            usage
            exit 0
            ;;
        --clean)
            clean
            exit 0
            ;;
        --target)
            build_target "$2"
            ;;
        --all)
            warn "Building all targets requires cross-compilation setup"
            warn "For CI/CD, use GitHub Actions workflow instead"
            build_native
            ;;
        --native|"")
            build_native
            ;;
        *)
            error "Unknown option: $1. Use --help for usage."
            ;;
    esac
    
    echo ""
    info "Release binaries in: $RELEASE_DIR"
    ls -la "$RELEASE_DIR/" 2>/dev/null || true
}

main "$@"

