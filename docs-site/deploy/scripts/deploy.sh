#!/bin/bash
# ===========================================
# VStats Cloud - Local Deployment Script
# ===========================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
cd "$DEPLOY_DIR"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
echo_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
echo_error() { echo -e "${RED}[ERROR]${NC} $1"; }

usage() {
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  start     - Start all services"
    echo "  stop      - Stop all services"
    echo "  restart   - Restart all services"
    echo "  status    - Show service status"
    echo "  logs      - Show service logs"
    echo "  update    - Pull latest images and restart"
    echo "  setup     - Initial setup (create .env, SSL, etc.)"
    echo ""
    exit 1
}

check_prerequisites() {
    if ! command -v docker &> /dev/null; then
        echo_error "Docker is not installed"
        exit 1
    fi
    
    if ! docker compose version &> /dev/null; then
        echo_error "Docker Compose is not installed"
        exit 1
    fi
}

setup() {
    echo_info "Running initial setup..."
    
    # 创建 .env 文件
    if [ ! -f .env ]; then
        echo_info "Creating .env from template..."
        cp env.example .env
        echo_warn "Please edit .env and set proper passwords!"
    else
        echo_info ".env already exists"
    fi
    
    # 创建 SSL 目录和证书
    if [ ! -f ssl/cert.pem ]; then
        echo_info "Generating self-signed SSL certificate..."
        mkdir -p ssl
        ./scripts/generate-ssl.sh
    else
        echo_info "SSL certificate already exists"
    fi
    
    # 创建必要的目录
    mkdir -p dist
    
    echo ""
    echo_info "Setup completed!"
    echo_warn "Next steps:"
    echo "  1. Edit .env and set secure passwords"
    echo "  2. Build frontend: cd ../.. && npm run build && cp -r dist/* deploy/dist/"
    echo "  3. (Optional) Replace self-signed SSL with Cloudflare Origin Certificate"
    echo "  4. Start services: ./scripts/deploy.sh start"
}

start() {
    echo_info "Starting VStats Cloud services..."
    
    # 检查配置
    if [ ! -f .env ]; then
        echo_error ".env file not found. Run: $0 setup"
        exit 1
    fi
    
    if [ ! -f ssl/cert.pem ]; then
        echo_error "SSL certificate not found. Run: $0 setup"
        exit 1
    fi
    
    docker compose up -d
    
    echo ""
    echo_info "Services started. Checking status..."
    sleep 3
    status
}

stop() {
    echo_info "Stopping VStats Cloud services..."
    docker compose down
    echo_info "Services stopped"
}

restart() {
    echo_info "Restarting VStats Cloud services..."
    docker compose restart
    echo_info "Services restarted"
}

status() {
    echo_info "Service Status:"
    echo ""
    docker compose ps
}

logs() {
    SERVICE="${1:-}"
    if [ -n "$SERVICE" ]; then
        docker compose logs -f "$SERVICE"
    else
        docker compose logs -f
    fi
}

update() {
    echo_info "Updating VStats Cloud services..."
    docker compose pull
    docker compose up -d --force-recreate
    echo_info "Update completed"
}

# 主逻辑
check_prerequisites

case "${1:-}" in
    start)   start ;;
    stop)    stop ;;
    restart) restart ;;
    status)  status ;;
    logs)    logs "$2" ;;
    update)  update ;;
    setup)   setup ;;
    *)       usage ;;
esac
