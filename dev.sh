#!/bin/bash
#
# Development server start script
# Rebuilds frontend and backend, then starts the server or cloud
#
# Usage:
#   ./dev.sh          # Start server (default)
#   ./dev.sh server   # Start server
#   ./dev.sh cloud    # Start cloud
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
SERVER_DIR="$PROJECT_ROOT/server-go"
WEB_DIR="$PROJECT_ROOT/web"
DOCS_SITE_DIR="$PROJECT_ROOT/docs-site"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

# Parse arguments
MODE="${1:-server}"

if [[ "$MODE" != "server" && "$MODE" != "cloud" ]]; then
    echo -e "${RED}Error: Unknown mode '$MODE'. Use 'server' or 'cloud'.${NC}"
    echo ""
    echo "Usage:"
    echo "  ./dev.sh          # Start server (default)"
    echo "  ./dev.sh server   # Start server"
    echo "  ./dev.sh cloud    # Start cloud"
    exit 1
fi

echo -e "${BLUE}════════════════════════════════════════${NC}"
if [[ "$MODE" == "server" ]]; then
    echo -e "${BLUE}       vStats Development Server        ${NC}"
else
    echo -e "${BLUE}        vStats Development Cloud        ${NC}"
fi
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""

# Check if Go is installed
if ! command -v go &> /dev/null; then
    echo -e "${RED}Error: Go is not installed. Please install Go 1.22 or later.${NC}"
    exit 1
fi

# ============================================================================
# Server Mode
# ============================================================================
if [[ "$MODE" == "server" ]]; then
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
    cd "$SERVER_DIR/cmd/server"
    go build -o "$PROJECT_ROOT/vstats-server-dev" .
    echo -e "${GREEN}✓ Backend built${NC}"
    echo ""

    # Build agent (optional, for testing)
    echo -e "${YELLOW}[3/4]${NC} Building agent..."
    cd "$SERVER_DIR/cmd/agent"
    go build -o "$PROJECT_ROOT/vstats-agent-dev" .
    echo -e "${GREEN}✓ Agent built${NC}"
    echo ""

    # Set environment variables
    export VSTATS_PORT=3001
    export VSTATS_WEB_DIR="$WEB_DIR/dist"

    SERVER_BINARY="$PROJECT_ROOT/vstats-server-dev"

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
    PASSWORD_OUTPUT=$("$SERVER_BINARY" --reset-password 2>&1)
    # Extract password from output (format: "║  New admin password: {password}     ║")
    # The password is a 16-char alphanumeric string
    ADMIN_PASSWORD=$(echo "$PASSWORD_OUTPUT" | grep "New admin password:" | sed -E 's/.*New admin password:[[:space:]]+([A-Za-z0-9]+)[[:space:]]*.*$/\1/')
    if [ -z "$ADMIN_PASSWORD" ]; then
        # Fallback: try to match any word after "password:"
        ADMIN_PASSWORD=$(echo "$PASSWORD_OUTPUT" | grep -oE 'password:[[:space:]]+[A-Za-z0-9]+' | tail -1 | sed -E 's/password:[[:space:]]+//')
    fi
    if [ -z "$ADMIN_PASSWORD" ]; then
        echo -e "${RED}Warning: Could not extract password from output${NC}"
        echo "Output was:"
        echo "$PASSWORD_OUTPUT"
        ADMIN_PASSWORD="(check output above)"
    fi
    echo -e "${GREEN}✓ Password reset${NC}"
    echo ""

    echo -e "${BLUE}════════════════════════════════════════${NC}"
    echo -e "${GREEN}Server: http://localhost:3001${NC}"
    echo -e "${GREEN}Web:    $VSTATS_WEB_DIR${NC}"
    echo -e "${GREEN}Pass:   ${ADMIN_PASSWORD}${NC}"
    echo -e "${BLUE}════════════════════════════════════════${NC}"
    echo ""

    # Change to project root and run
    cd "$PROJECT_ROOT"
    "$SERVER_BINARY"
fi

# ============================================================================
# Cloud Mode
# ============================================================================
if [[ "$MODE" == "cloud" ]]; then
    # Build docs-site frontend
    echo -e "${YELLOW}[1/4]${NC} Building docs-site frontend..."
    cd "$DOCS_SITE_DIR"
    if [ ! -d "node_modules" ]; then
        npm install
    fi
    npm run build
    echo -e "${GREEN}✓ Docs-site frontend built${NC}"
    echo ""

    # Build cloud backend
    echo -e "${YELLOW}[2/4]${NC} Building cloud backend..."
    cd "$SERVER_DIR/cmd/cloud"
    go build -o "$PROJECT_ROOT/vstats-cloud-dev" .
    echo -e "${GREEN}✓ Cloud backend built${NC}"
    echo ""

    # Build agent (optional, for testing)
    echo -e "${YELLOW}[3/4]${NC} Building agent..."
    cd "$SERVER_DIR/cmd/agent"
    go build -o "$PROJECT_ROOT/vstats-agent-dev" .
    echo -e "${GREEN}✓ Agent built${NC}"
    echo ""

    # Kill existing vstats-cloud processes
    echo -e "${YELLOW}[0/4]${NC} Stopping existing services..."
    if pgrep -f "vstats-cloud" > /dev/null 2>&1; then
        echo -e "${YELLOW}  Found running vstats-cloud processes, stopping...${NC}"
        pkill -f "vstats-cloud" || true
        sleep 1
        # Force kill if still running
        if pgrep -f "vstats-cloud" > /dev/null 2>&1; then
            pkill -9 -f "vstats-cloud" || true
            sleep 0.5
        fi
        echo -e "${GREEN}✓ Old services stopped${NC}"
    else
        echo -e "${GREEN}✓ No existing services found${NC}"
    fi
    echo ""

    # Check if Docker is running (for PostgreSQL and Redis)
    echo -e "${YELLOW}[4/4]${NC} Checking dependencies (PostgreSQL, Redis)..."
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Error: Docker is not installed. Cloud mode requires Docker for PostgreSQL and Redis.${NC}"
        exit 1
    fi

    # Start PostgreSQL and Redis if not running (use existing test containers)
    cd "$PROJECT_ROOT"
    if ! docker ps | grep -q "vstats-postgres-test"; then
        echo -e "${YELLOW}  Starting PostgreSQL...${NC}"
        docker run -d --name vstats-postgres-test \
            -e POSTGRES_USER=vstats \
            -e POSTGRES_PASSWORD=vstats_test_password \
            -e POSTGRES_DB=vstats_cloud \
            -p 5432:5432 \
            postgres:15-alpine 2>/dev/null || docker start vstats-postgres-test
    else
        echo -e "${GREEN}  PostgreSQL already running${NC}"
    fi

    if ! docker ps | grep -q "vstats-redis-test"; then
        echo -e "${YELLOW}  Starting Redis...${NC}"
        docker run -d --name vstats-redis-test \
            -p 6379:6379 \
            redis:7-alpine redis-server --requirepass vstats_redis_test 2>/dev/null || docker start vstats-redis-test
    else
        echo -e "${GREEN}  Redis already running${NC}"
    fi

    # Wait for services to be ready
    echo -e "${YELLOW}  Waiting for services to be ready...${NC}"
    sleep 2
    echo -e "${GREEN}✓ Dependencies ready${NC}"
    echo ""

    # Set environment variables for cloud (match existing test containers)
    export PORT=3002
    export APP_ENV=development
    export APP_URL=http://localhost:3002
    export STATIC_DIR="$DOCS_SITE_DIR/dist"
    export DATABASE_URL="postgres://vstats:vstats_test_password@localhost:5432/vstats_cloud?sslmode=disable"
    export REDIS_URL="redis://:vstats_redis_test@localhost:6379/0"
    export JWT_SECRET="dev-jwt-secret-change-in-prod"
    export SESSION_SECRET="dev-session-secret-change-in-prod"
    export CORS_ORIGINS="*"

    # OAuth - uncomment and set your credentials
    # export GITHUB_CLIENT_ID="your-github-client-id"
    # export GITHUB_CLIENT_SECRET="your-github-client-secret"
    # export GOOGLE_CLIENT_ID="your-google-client-id"
    # export GOOGLE_CLIENT_SECRET="your-google-client-secret"

    # Load from .env.local if exists (for OAuth secrets)
    if [ -f "$PROJECT_ROOT/.env.local" ]; then
        echo -e "${YELLOW}  Loading .env.local...${NC}"
        set -a
        source "$PROJECT_ROOT/.env.local"
        set +a
    fi

    CLOUD_BINARY="$PROJECT_ROOT/vstats-cloud-dev"

    echo -e "${BLUE}════════════════════════════════════════${NC}"
    echo -e "${GREEN}Cloud:  http://localhost:3002${NC}"
    echo -e "${GREEN}Static: $STATIC_DIR${NC}"
    echo -e "${GREEN}DB:     PostgreSQL @ localhost:5432${NC}"
    echo -e "${GREEN}Redis:  localhost:6379${NC}"
    echo -e "${BLUE}════════════════════════════════════════${NC}"
    echo ""

    # Change to project root and run
    cd "$PROJECT_ROOT"
    "$CLOUD_BINARY"
fi
