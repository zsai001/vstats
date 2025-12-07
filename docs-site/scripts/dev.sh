#!/bin/bash
# ============================================
# VStats Cloud - 开发环境启动脚本
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$ROOT_DIR")"

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              VStats Cloud - Development Mode                   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# 检查依赖
check_deps() {
    if ! command -v go &> /dev/null; then
        echo -e "${YELLOW}[WARN] Go is not installed${NC}"
        exit 1
    fi
    
    if ! command -v node &> /dev/null; then
        echo -e "${YELLOW}[WARN] Node.js is not installed${NC}"
        exit 1
    fi
}

# 启动 PostgreSQL 和 Redis (如果使用 docker-compose)
start_db() {
    if command -v docker &> /dev/null; then
        echo -e "${GREEN}[INFO] Starting PostgreSQL and Redis...${NC}"
        cd "$ROOT_DIR/deploy"
        docker compose up -d postgres redis 2>/dev/null || true
        cd "$ROOT_DIR"
        sleep 2
    else
        echo -e "${YELLOW}[WARN] Docker not found. Make sure PostgreSQL and Redis are running.${NC}"
    fi
}

# 启动后端
start_backend() {
    echo -e "${GREEN}[INFO] Starting Cloud Backend (Go)...${NC}"
    cd "$PROJECT_ROOT/server-go"
    
    # 设置环境变量
    export DATABASE_URL="postgres://vstats:vstats_secure_password@localhost:5432/vstats_cloud?sslmode=disable"
    export REDIS_URL="redis://:vstats_redis_password@localhost:6379/0"
    export JWT_SECRET="dev-jwt-secret-change-in-production"
    export SESSION_SECRET="dev-session-secret"
    export APP_URL="http://localhost:5173"
    export APP_ENV="development"
    export PORT="3001"
    
    go run ./cmd/cloud &
    BACKEND_PID=$!
    echo -e "${GREEN}[INFO] Backend started (PID: $BACKEND_PID)${NC}"
}

# 启动前端
start_frontend() {
    echo -e "${GREEN}[INFO] Starting Frontend (Vite)...${NC}"
    cd "$ROOT_DIR"
    
    # 安装依赖（如果需要）
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}[INFO] Installing npm dependencies...${NC}"
        npm install
    fi
    
    npm run dev &
    FRONTEND_PID=$!
    echo -e "${GREEN}[INFO] Frontend started (PID: $FRONTEND_PID)${NC}"
}

# 清理
cleanup() {
    echo ""
    echo -e "${YELLOW}[INFO] Shutting down...${NC}"
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    exit 0
}

trap cleanup SIGINT SIGTERM

# 主流程
check_deps
start_db
start_backend
sleep 2
start_frontend

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    Development servers started!                ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Frontend:  http://localhost:5173                              ║${NC}"
echo -e "${GREEN}║  Backend:   http://localhost:3001                              ║${NC}"
echo -e "${GREEN}║  API Docs:  http://localhost:3001/health                       ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Press Ctrl+C to stop all servers                              ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"

# 等待
wait
