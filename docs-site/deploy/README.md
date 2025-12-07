# VStats Cloud 部署指南

本目录包含 VStats Cloud 服务的完整部署配置，使用 Docker Compose 一键部署所有服务。

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                       Cloudflare                            │
│                    (DNS + CDN + SSL)                        │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Docker Compose                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Nginx (Port 80/443)                                  │   │
│  │  - 静态文件服务 (前端)                                │   │
│  │  - 反向代理 API                                      │   │
│  │  - WebSocket 代理                                    │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                   │
│                         ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ API Server (Port 3001)                              │   │
│  │  - REST API                                          │   │
│  │  - WebSocket                                         │   │
│  │  - OAuth 认证                                        │   │
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
├── nginx/
│   ├── nginx.conf        # Nginx 主配置
│   └── conf.d/
│       └── default.conf  # 站点配置
├── ssl/                  # SSL 证书目录 (需手动创建)
│   ├── cert.pem          # 证书文件
│   └── key.pem           # 私钥文件
├── dist/                 # 前端构建产物 (由 CI/CD 自动部署)
├── scripts/
│   ├── deploy.sh         # 部署管理脚本
│   ├── generate-ssl.sh   # SSL 证书生成脚本
│   ├── backup.sh         # 数据库备份脚本
│   └── restore.sh        # 数据库恢复脚本
├── env.example           # 环境变量示例
└── README.md             # 本文件
```

## 快速开始

### 1. 初始化配置

```bash
cd deploy

# 运行初始化脚本 (创建 .env, SSL 证书等)
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
- OAuth 相关配置 (GitHub/Google)

### 3. 配置 SSL 证书

**方式一：使用 Cloudflare Origin Certificate (推荐)**

1. 登录 Cloudflare Dashboard
2. 进入 SSL/TLS > Origin Server
3. Create Certificate
4. 保存证书到 `ssl/cert.pem`
5. 保存私钥到 `ssl/key.pem`

**方式二：使用自签名证书 (仅开发环境)**

```bash
./scripts/generate-ssl.sh vstats.example.com
```

### 4. 启动服务

```bash
# 启动所有服务
./scripts/deploy.sh start

# 查看状态
./scripts/deploy.sh status

# 查看日志
./scripts/deploy.sh logs
```

## GitHub Actions 自动部署

代码推送到 `main` 分支后，GitHub Actions 会自动：

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

## 数据库 Schema

### 核心表结构

| 表名 | 说明 |
|------|------|
| `users` | 用户账户 |
| `oauth_providers` | OAuth 登录信息 (GitHub/Google) |
| `sessions` | 用户会话 |
| `servers` | 监控的服务器 |
| `server_metrics` | 服务器指标数据 |
| `alert_rules` | 告警规则 |
| `alert_history` | 告警历史 |
| `api_keys` | API 密钥 |
| `audit_logs` | 审计日志 |
| `subscriptions` | 订阅信息 |

### ER 图简述

```
users (1) ----< (N) oauth_providers
users (1) ----< (N) sessions
users (1) ----< (N) servers
users (1) ----< (N) alert_rules
users (1) ----< (N) api_keys
users (1) ----< (N) subscriptions

servers (1) ----< (N) server_metrics
servers (1) ----< (N) alert_history

alert_rules (1) ----< (N) alert_history
```

## Redis 使用说明

Redis 用于以下场景：

1. **Session 存储** - 用户登录会话缓存
2. **API 限流** - 请求频率限制
3. **实时数据** - WebSocket 连接状态、实时指标
4. **缓存** - 频繁查询的数据缓存

### Key 命名规范

```
vstats:session:{session_id}     # 用户会话
vstats:user:{user_id}:cache     # 用户缓存数据
vstats:server:{server_id}:live  # 服务器实时状态
vstats:ratelimit:{ip}:{endpoint} # API 限流计数器
vstats:ws:connections           # WebSocket 连接数
```

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
./scripts/deploy.sh logs nginx
./scripts/deploy.sh logs api

# 更新服务
./scripts/deploy.sh update
```

### Docker Compose (直接使用)

```bash
# 启动服务
docker compose up -d

# 停止服务
docker compose down

# 重启服务
docker compose restart

# 查看日志
docker compose logs -f nginx
docker compose logs -f api
docker compose logs -f postgres
docker compose logs -f redis

# 进入容器
docker exec -it vstats-nginx sh
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

# 清理过期会话
docker exec -it vstats-postgres psql -U vstats -d vstats_cloud -c "SELECT cleanup_expired_sessions();"

# 清理旧指标数据 (保留30天)
docker exec -it vstats-postgres psql -U vstats -d vstats_cloud -c "SELECT cleanup_old_metrics(30);"
```

### Redis 管理

```bash
# 连接 Redis CLI
docker exec -it vstats-redis redis-cli -a your_redis_password

# 查看内存使用
docker exec -it vstats-redis redis-cli -a your_redis_password INFO memory

# 清空缓存 (谨慎!)
docker exec -it vstats-redis redis-cli -a your_redis_password FLUSHDB
```

## 生产环境建议

### 安全性

1. **修改默认密码** - 务必修改所有默认密码
2. **限制端口访问** - 建议不对外暴露 5432 和 6379 端口
3. **启用 SSL** - 确保所有流量走 HTTPS
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
     -c checkpoint_completion_target=0.9
   ```

2. **Redis 调优**
   - 已配置 maxmemory 和 LRU 策略
   - 根据实际使用调整内存限制

3. **指标数据分区**
   - 对于大量数据，考虑按时间分区 `server_metrics` 表

### 监控

建议使用以下工具监控服务状态：
- PostgreSQL: pgAdmin 或 Grafana + Prometheus
- Redis: Redis Commander 或 RedisInsight

## 故障排除

### PostgreSQL 无法启动

```bash
# 检查日志
docker compose logs postgres

# 检查数据目录权限
ls -la ./data/postgres
```

### Redis 连接失败

```bash
# 检查密码是否正确
docker exec -it vstats-redis redis-cli -a wrong_password ping

# 检查服务状态
docker compose ps redis
```

### 数据库初始化失败

```bash
# 重新初始化 (会清空数据!)
docker compose down -v
docker compose up -d
```

## 联系支持

如有问题，请通过以下方式联系：
- GitHub Issues: https://github.com/zsai001/vstats/issues
- 文档站点: https://vstats.zsoft.cc
