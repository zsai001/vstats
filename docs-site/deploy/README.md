# VStats Cloud 部署指南

本目录包含 VStats Cloud 服务的部署配置，使用 Docker Compose 部署核心服务。

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    External Nginx                           │
│              (由你配置 SSL + 反向代理)                       │
│                         ↓                                   │
│                   127.0.0.1:3001                           │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Docker Compose                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ API Server (127.0.0.1:3001)                         │   │
│  │  - REST API                                          │   │
│  │  - WebSocket                                         │   │
│  │  - OAuth 认证                                        │   │
│  │  - 静态文件服务 (前端)                               │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                   │
│           ┌─────────────┴─────────────┐                    │
│           ▼                           ▼                    │
│  ┌─────────────────┐      ┌─────────────────┐              │
│  │ PostgreSQL      │      │ Redis           │              │
│  │ (数据持久化)     │      │ (缓存/会话)     │              │
│  └─────────────────┘      └─────────────────┘              │
└─────────────────────────────────────────────────────────────┘
```

## 目录结构

```
deploy/
├── docker-compose.yml    # Docker Compose 主配置
├── db/
│   └── schema.sql        # 数据库初始化 Schema
├── dist/                 # 前端构建产物 (由 CI/CD 自动部署)
├── scripts/
│   ├── deploy.sh         # 部署管理脚本
│   ├── backup.sh         # 数据库备份脚本
│   └── restore.sh        # 数据库恢复脚本
├── env.example           # 环境变量示例
└── README.md             # 本文件
```

## 快速开始

### 1. 初始化配置

```bash
cd deploy

# 运行初始化脚本 (创建 .env)
./scripts/deploy.sh setup
```

### 2. 配置环境变量

```bash
# 编辑配置文件
vim .env
```

**必须修改的配置：**
- `POSTGRES_PASSWORD` - PostgreSQL 密码
- `REDIS_PASSWORD` - Redis 密码
- `SESSION_SECRET` - Session 密钥
- `JWT_SECRET` - JWT 密钥
- `APP_URL` - 应用 URL (用于 OAuth 回调)
- OAuth 相关配置 (GitHub/Google)

### 3. 启动服务

```bash
# 启动所有服务
./scripts/deploy.sh start

# 查看状态
./scripts/deploy.sh status

# 查看日志
./scripts/deploy.sh logs
```

### 4. 配置外部 Nginx

服务启动后会在 `127.0.0.1:3001` 暴露 API。你需要配置外部 Nginx 来代理请求并处理 SSL。

**Nginx 配置示例：**

```nginx
server {
    listen 80;
    server_name vstats.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name vstats.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## GitHub Actions 自动部署

代码推送到 `main` 分支后，`deploy-docs-site.yml` 会自动：

1. 构建前端
2. 打包部署文件
3. 上传到服务器
4. 使用 Docker Compose 部署

### 部署类型

在 GitHub Actions 中可以手动触发不同类型的部署：

| 类型 | 说明 |
|------|------|
| `frontend` | 仅更新前端静态文件 (默认) |
| `full` | 完整部署，更新所有服务和配置 |
| `restart` | 仅重启服务 |

### 必需的 GitHub Secrets

| Secret | 说明 |
|--------|------|
| `DEPLOY_HOST` | 服务器 IP 或域名 |
| `DEPLOY_USER` | SSH 用户名 |
| `DEPLOY_SSH_KEY` | SSH 私钥 |
| `DEPLOY_PORT` | SSH 端口 (可选，默认 22) |

## 运维命令

### 使用部署脚本 (推荐)

```bash
# 启动服务
./scripts/deploy.sh start

# 停止服务
./scripts/deploy.sh stop

# 重启服务
./scripts/deploy.sh restart

# 查看状态
./scripts/deploy.sh status

# 查看日志
./scripts/deploy.sh logs
./scripts/deploy.sh logs api

# 更新服务
./scripts/deploy.sh update

# 健康检查
./scripts/deploy.sh health
```

### Docker Compose (直接使用)

```bash
# 启动服务
docker compose up -d

# 停止服务
docker compose down

# 查看日志
docker compose logs -f api
docker compose logs -f postgres
docker compose logs -f redis

# 进入容器
docker exec -it vstats-api sh
docker exec -it vstats-postgres bash
docker exec -it vstats-redis sh
```

### 数据库管理

```bash
# 连接数据库
docker exec -it vstats-postgres psql -U vstats -d vstats_cloud

# 备份数据库
./scripts/backup.sh

# 恢复数据库
./scripts/restore.sh backup_file.sql
```

### Redis 管理

```bash
# 连接 Redis CLI
docker exec -it vstats-redis redis-cli -a your_redis_password

# 查看内存使用
docker exec -it vstats-redis redis-cli -a your_redis_password INFO memory
```

## 生产环境建议

### 安全性

1. **修改默认密码** - 务必修改所有默认密码
2. **限制端口访问** - 服务只绑定 127.0.0.1，由外部 Nginx 处理公网访问
3. **启用 SSL** - 在外部 Nginx 配置 SSL 证书
4. **定期备份** - 设置自动备份策略

### 性能优化

1. **PostgreSQL 调优**
   ```bash
   # 在 docker-compose.yml 中添加
   command: >
     postgres
     -c shared_buffers=256MB
     -c effective_cache_size=768MB
     -c maintenance_work_mem=64MB
   ```

2. **Redis 调优**
   - 已配置 maxmemory 和 LRU 策略
   - 根据实际使用调整内存限制

## 故障排除

### PostgreSQL 无法启动

```bash
# 检查日志
docker compose logs postgres
```

### Redis 连接失败

```bash
# 检查密码是否正确
docker exec -it vstats-redis redis-cli -a wrong_password ping

# 检查服务状态
docker compose ps redis
```

### API 容器显示 unhealthy

```bash
# 查看 API 容器日志
docker compose logs api

# 手动测试健康检查端点
curl http://127.0.0.1:3001/health

# 检查环境变量配置
docker exec vstats-api env | grep -E "DATABASE_URL|REDIS_URL|PORT"
```

## 联系支持

如有问题，请通过以下方式联系：
- GitHub Issues: https://github.com/zsai001/vstats/issues
- 文档站点: https://vstats.zsoft.cc
