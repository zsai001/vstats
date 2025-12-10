#!/bin/bash
# ===========================================
# VStats Cloud - 本地测试脚本
# 编译、启动、测试完整流程
# ===========================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(cd "$DEPLOY_DIR/../.." && pwd)"
SERVER_GO_DIR="$PROJECT_ROOT/server-go"
DOCS_SITE_DIR="$PROJECT_ROOT/docs-site"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
echo_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
echo_error() { echo -e "${RED}[ERROR]${NC} $1"; }
echo_step() { echo -e "\n${BLUE}=== $1 ===${NC}"; }

cleanup() {
    echo_step "清理"
    if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
        echo_info "停止 API 服务器 (PID: $API_PID)..."
        kill "$API_PID" 2>/dev/null || true
    fi
    if [ "$STARTED_DOCKER" = "true" ]; then
        echo_info "停止 Docker 服务..."
        cd "$DEPLOY_DIR"
        docker compose down 2>/dev/null || true
    fi
}

trap cleanup EXIT

# ===========================================
# 1. 检查依赖
# ===========================================
echo_step "检查依赖"

# 检查 Go
if ! command -v go &> /dev/null; then
    echo_error "Go 未安装"
    exit 1
fi
echo_info "Go: $(go version)"

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo_error "Node.js 未安装"
    exit 1
fi
echo_info "Node.js: $(node --version)"

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo_error "Docker 未安装"
    exit 1
fi
echo_info "Docker: $(docker --version)"

# ===========================================
# 2. 编译 Go 后端
# ===========================================
echo_step "编译 Go 后端"

cd "$SERVER_GO_DIR"
echo_info "目录: $SERVER_GO_DIR"

echo_info "下载依赖..."
go mod download

echo_info "编译 vstats-cloud..."
go build -o "$DEPLOY_DIR/vstats-cloud" ./cmd/cloud/

if [ -f "$DEPLOY_DIR/vstats-cloud" ]; then
    echo_info "✅ 编译成功: $DEPLOY_DIR/vstats-cloud"
else
    echo_error "编译失败"
    exit 1
fi

# ===========================================
# 3. 构建前端
# ===========================================
echo_step "构建前端"

cd "$DOCS_SITE_DIR"
echo_info "目录: $DOCS_SITE_DIR"

echo_info "安装依赖..."
npm ci --silent

echo_info "构建前端..."
npm run build

if [ -d "$DOCS_SITE_DIR/dist" ]; then
    echo_info "✅ 构建成功: $DOCS_SITE_DIR/dist"
    
    # 复制到 deploy 目录
    mkdir -p "$DEPLOY_DIR/dist"
    cp -r "$DOCS_SITE_DIR/dist"/* "$DEPLOY_DIR/dist/"
    echo_info "✅ 已复制到: $DEPLOY_DIR/dist"
else
    echo_error "构建失败"
    exit 1
fi

# ===========================================
# 4. 启动数据库服务
# ===========================================
echo_step "启动数据库服务 (PostgreSQL + Redis)"

cd "$DEPLOY_DIR"

# 创建 .env 文件 (如果不存在)
if [ ! -f .env ]; then
    echo_info "创建测试用 .env 文件..."
    cat > .env << 'EOF'
POSTGRES_USER=vstats
POSTGRES_PASSWORD=vstats_test_password
POSTGRES_DB=vstats_cloud
REDIS_PASSWORD=vstats_redis_test
JWT_SECRET=test_jwt_secret_key_12345
SESSION_SECRET=test_session_secret_key_12345
APP_URL=http://localhost:3001
EOF
fi

# 只启动数据库服务
echo_info "启动 PostgreSQL 和 Redis..."
docker compose up -d postgres redis
STARTED_DOCKER=true

# 等待服务就绪
echo_info "等待数据库服务就绪..."
for i in {1..30}; do
    if docker compose exec -T postgres pg_isready -U vstats -d vstats_cloud &>/dev/null; then
        echo_info "✅ PostgreSQL 就绪"
        break
    fi
    if [ $i -eq 30 ]; then
        echo_error "PostgreSQL 启动超时"
        docker compose logs postgres
        exit 1
    fi
    sleep 1
done

for i in {1..30}; do
    if docker compose exec -T redis redis-cli -a vstats_redis_test ping &>/dev/null; then
        echo_info "✅ Redis 就绪"
        break
    fi
    if [ $i -eq 30 ]; then
        echo_error "Redis 启动超时"
        docker compose logs redis
        exit 1
    fi
    sleep 1
done

# ===========================================
# 5. 启动 API 服务器
# ===========================================
echo_step "启动 API 服务器"

cd "$DEPLOY_DIR"

# 设置环境变量
export PORT=3001
export APP_ENV=development
export DATABASE_URL="postgres://vstats:vstats_test_password@localhost:5432/vstats_cloud?sslmode=disable"
export REDIS_URL="redis://:vstats_redis_test@localhost:6379/0"
export JWT_SECRET=test_jwt_secret_key_12345
export SESSION_SECRET=test_session_secret_key_12345
export STATIC_DIR="$DEPLOY_DIR/dist"
export APP_URL="http://localhost:3001"
export CORS_ORIGINS="*"

# 暴露 PostgreSQL 和 Redis 端口给本地访问
echo_info "暴露数据库端口..."
docker compose up -d postgres redis

# 临时修改端口映射
docker compose stop postgres redis 2>/dev/null || true

# 使用带端口映射的临时配置 (使用绝对路径避免相对路径问题)
cat > /tmp/docker-compose-test.yml << EOF
services:
  postgres:
    image: postgres:15-alpine
    container_name: vstats-postgres-test
    environment:
      POSTGRES_USER: vstats
      POSTGRES_PASSWORD: vstats_test_password
      POSTGRES_DB: vstats_cloud
    ports:
      - "5432:5432"
    volumes:
      - ${DEPLOY_DIR}/db/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vstats -d vstats_cloud"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: vstats-redis-test
    command: redis-server --requirepass vstats_redis_test
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "vstats_redis_test", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
EOF

# 停止旧容器，启动测试容器
docker compose down 2>/dev/null || true
docker compose -f /tmp/docker-compose-test.yml up -d

# 等待服务就绪
echo_info "等待数据库服务就绪..."
sleep 5

for i in {1..30}; do
    if docker exec vstats-postgres-test pg_isready -U vstats -d vstats_cloud &>/dev/null; then
        echo_info "✅ PostgreSQL 就绪 (localhost:5432)"
        break
    fi
    if [ $i -eq 30 ]; then
        echo_error "PostgreSQL 启动超时"
        exit 1
    fi
    sleep 1
done

for i in {1..30}; do
    if docker exec vstats-redis-test redis-cli -a vstats_redis_test ping &>/dev/null; then
        echo_info "✅ Redis 就绪 (localhost:6379)"
        break
    fi
    if [ $i -eq 30 ]; then
        echo_error "Redis 启动超时"
        exit 1
    fi
    sleep 1
done

echo_info "启动 API 服务器..."
"$DEPLOY_DIR/vstats-cloud" &
API_PID=$!

# 等待 API 启动
sleep 3

if ! kill -0 "$API_PID" 2>/dev/null; then
    echo_error "API 服务器启动失败"
    exit 1
fi
echo_info "✅ API 服务器启动成功 (PID: $API_PID)"

# ===========================================
# 6. 测试
# ===========================================
echo_step "运行测试"

sleep 2

# 测试健康检查
echo_info "测试 /health..."
HEALTH=$(curl -sf http://localhost:3001/health 2>&1) || true
if echo "$HEALTH" | grep -q "ok\|healthy"; then
    echo_info "✅ /health - OK"
else
    echo_warn "⚠️  /health - 响应: $HEALTH"
fi

# 测试详细健康检查
echo_info "测试 /health/detailed..."
DETAILED=$(curl -sf http://localhost:3001/health/detailed 2>&1) || true
if echo "$DETAILED" | grep -q "database\|redis"; then
    echo_info "✅ /health/detailed - OK"
    echo "   $DETAILED"
else
    echo_warn "⚠️  /health/detailed - 响应: $DETAILED"
fi

# 测试版本
echo_info "测试 /version..."
VERSION=$(curl -sf http://localhost:3001/version 2>&1) || true
if [ -n "$VERSION" ]; then
    echo_info "✅ /version - $VERSION"
else
    echo_warn "⚠️  /version - 无响应"
fi

# 测试静态文件服务
echo_info "测试静态文件服务..."
INDEX=$(curl -sf http://localhost:3001/ 2>&1 | head -c 200) || true
if echo "$INDEX" | grep -qi "html\|doctype\|vstats"; then
    echo_info "✅ / (index.html) - OK"
else
    echo_warn "⚠️  / (index.html) - 响应: ${INDEX:0:100}..."
fi

# 测试 SPA 路由回退
echo_info "测试 SPA 路由 /cloud..."
CLOUD=$(curl -sf http://localhost:3001/cloud 2>&1 | head -c 200) || true
if echo "$CLOUD" | grep -qi "html\|doctype\|vstats"; then
    echo_info "✅ /cloud (SPA fallback) - OK"
else
    echo_warn "⚠️  /cloud - 响应: ${CLOUD:0:100}..."
fi

# 测试 API 404
echo_info "测试 API 404..."
API404=$(curl -sf http://localhost:3001/api/nonexistent 2>&1) || true
if echo "$API404" | grep -q "Not found\|not found\|404"; then
    echo_info "✅ /api/nonexistent - 正确返回 404"
else
    echo_warn "⚠️  /api/nonexistent - 响应: $API404"
fi

# ===========================================
# 总结
# ===========================================
echo_step "测试完成"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  本地测试环境正在运行!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "  🌐 前端页面: http://localhost:3001"
echo "  🔧 API 健康检查: http://localhost:3001/health"
echo "  📡 WebSocket: ws://localhost:3001/ws/agent"
echo ""
echo "  按 Ctrl+C 停止服务"
echo ""

# 保持运行
wait $API_PID
