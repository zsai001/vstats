# VStats Cloud Server

VStats Cloud 后端服务，提供多用户服务器监控 SaaS 平台。

## 功能特性

- **多用户支持**: OAuth 登录 (GitHub/Google)
- **服务器管理**: 每个用户管理自己的服务器
- **实时监控**: WebSocket 实时指标推送
- **API 服务**: RESTful API
- **数据存储**: PostgreSQL + Redis

## 技术栈

- Go 1.22+
- Gin Web Framework
- PostgreSQL 15+
- Redis 7+
- WebSocket (gorilla/websocket)
- JWT 认证

## 目录结构

```
server-go/
├── cmd/
│   ├── agent/       # Agent 客户端
│   ├── server/      # 自部署服务器
│   └── cloud/       # Cloud 服务 (本目录)
├── internal/
│   ├── common/      # 共享代码
│   └── cloud/       # Cloud 专用代码
│       ├── config/      # 配置管理
│       ├── database/    # PostgreSQL 操作
│       ├── redis/       # Redis 操作
│       ├── auth/        # 认证 (JWT/OAuth)
│       ├── handlers/    # HTTP 处理器
│       ├── middleware/  # 中间件
│       ├── models/      # 数据模型
│       └── websocket/   # WebSocket 处理
└── go.mod
```

## 环境变量

```bash
# 服务配置
PORT=3001
APP_ENV=production
APP_URL=https://vstats.example.com
LOG_LEVEL=info

# 数据库
DATABASE_URL=postgres://user:pass@localhost:5432/vstats_cloud?sslmode=disable

# Redis
REDIS_URL=redis://:password@localhost:6379/0

# 认证
JWT_SECRET=your-jwt-secret
SESSION_SECRET=your-session-secret

# OAuth
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx

# 其他
CORS_ORIGINS=https://vstats.example.com
METRICS_RETENTION_DAYS=30
```

## API 端点

### 公开端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/version` | 版本信息 |
| GET | `/api/auth/providers` | 可用的 OAuth 提供商 |
| GET | `/api/auth/oauth/github` | GitHub OAuth 开始 |
| GET | `/api/auth/oauth/google` | Google OAuth 开始 |
| GET | `/ws/agent?key=xxx` | Agent WebSocket |

### 认证端点 (需要 JWT)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/verify` | 验证 Token |
| GET | `/api/auth/me` | 当前用户信息 |
| POST | `/api/auth/logout` | 登出 |

### 服务器管理 (需要 JWT)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/servers` | 列出服务器 |
| POST | `/api/servers` | 创建服务器 |
| GET | `/api/servers/:id` | 获取服务器详情 |
| PUT | `/api/servers/:id` | 更新服务器 |
| DELETE | `/api/servers/:id` | 删除服务器 |
| POST | `/api/servers/:id/regenerate-key` | 重新生成 Agent Key |
| GET | `/api/servers/:id/install-command` | 获取安装命令 |
| GET | `/api/servers/:id/metrics` | 获取最新指标 |
| GET | `/api/servers/:id/history` | 获取历史指标 |

### WebSocket

| 路径 | 说明 |
|------|------|
| `/ws/agent?key=xxx` | Agent 连接 (使用 agent_key 认证) |
| `/api/ws` | Dashboard 连接 (需要 JWT) |

## 本地开发

```bash
# 启动 PostgreSQL 和 Redis
docker compose -f docs-site/deploy/docker-compose.yml up -d postgres redis

# 设置环境变量
export DATABASE_URL="postgres://vstats:vstats@localhost:5432/vstats_cloud?sslmode=disable"
export REDIS_URL="redis://:vstats@localhost:6379/0"
export JWT_SECRET="dev-secret"

# 运行
cd server-go
go run ./cmd/cloud
```

## 构建

```bash
# 本地构建
cd server-go
go build -o vstats-cloud ./cmd/cloud

# Docker 构建
docker build -f Dockerfile.cloud -t vstats-cloud .
```

## 部署

参考 `docs-site/deploy/` 目录下的 Docker Compose 配置进行部署。
