# GitHub Actions 工作流说明

## Build, Release and Deploy

这是 vStats 的统一构建、发布和部署工作流。**Rust 版本已弃用，所有构建现在都使用 Go。**

### 触发方式

1. **Tag 推送**：当推送以 `v` 开头的 tag 时（例如 `v2.2.1`）
   - 构建所有 Go 二进制文件
   - 构建 Web 前端
   - 创建 GitHub Release

2. **Main 分支推送**：当 `server-go/`、`web/`、`docs-site/` 或 `docs/` 目录有更改时
   - 构建对应的组件（Go 二进制文件、Web 前端或文档站点）

3. **手动触发**：在 GitHub Actions 页面手动运行，需要提供版本号

### 支持的平台

#### Server (vstats-server)
| 平台 | 架构 |
|------|------|
| Linux | amd64, arm64 |
| macOS | amd64 (Intel), arm64 (Apple Silicon) |
| Windows | amd64 |
| FreeBSD | amd64, arm64 |

#### Agent (vstats-agent)
| 平台 | 架构 |
|------|------|
| Linux | amd64, arm64 |
| macOS | amd64 (Intel), arm64 (Apple Silicon) |
| Windows | amd64 |
| FreeBSD | amd64, arm64 |

### 使用方法

#### 自动发布（推荐）

1. 创建并推送 tag：
   ```bash
   git tag v2.2.1
   git push origin v2.2.1
   ```

2. GitHub Actions 会自动：
   - 编译所有平台和架构的二进制文件
   - 构建 Web 前端
   - 创建 GitHub Release（包含所有二进制文件、Web 资源和校验和）

#### 手动发布

1. 前往 GitHub Actions 页面
2. 选择 "Build, Release and Deploy" 工作流
3. 点击 "Run workflow"
4. 输入版本号（例如：`2.2.1`）
5. 点击 "Run workflow"

### 版本号格式

- 版本号应该遵循语义化版本（Semantic Versioning）
- Tag 格式：`v2.2.1`（带 `v` 前缀）
- 版本号会被注入到二进制文件中，可通过 `--version` 或 API 查询

### 输出文件

每个发布会生成：

#### 二进制文件
- `vstats-server-{platform}-{arch}` 或 `.exe`
- `vstats-agent-{platform}-{arch}` 或 `.exe`

#### Web 前端
- `web-dist.tar.gz` - 预构建的 Web 资源（tar.gz 格式）
- `web-dist.zip` - 预构建的 Web 资源（zip 格式）

#### 校验和
- `checksums.txt` - 所有文件的 SHA256 校验和

### 构建参数

- Go 版本：1.22
- Node.js 版本：20
- CGO：禁用（静态链接）
- 构建标志：`-trimpath -a -installsuffix cgo`

### 文档站点部署

文档站点（docs-site）使用独立的部署工作流 `deploy-docs-site.yml`：
- 使用 Docker Compose + Nginx 部署
- 编译后的静态文件通过 Nginx 提供服务
- 支持自动部署到服务器
