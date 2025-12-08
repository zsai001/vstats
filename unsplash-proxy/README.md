# vStats Unsplash Proxy

Cloudflare Worker 用于代理 Unsplash API 请求，解决 `source.unsplash.com` 已弃用的问题。

## 功能

- 🖼️ 获取随机图片（支持关键词、方向、尺寸参数）
- 🔍 搜索图片
- 📷 获取指定 ID 的图片
- ⚡ 内置缓存（5分钟）
- 🌐 支持 CORS

## API 端点

### 获取随机图片

```
GET /random?query=nature,landscape&orientation=landscape&w=1920&h=1080
```

参数：
- `query` - 搜索关键词（默认：nature,landscape）
- `orientation` - 方向：landscape/portrait/squarish（默认：landscape）
- `w` - 宽度（默认：1920）
- `h` - 高度（默认：1080）

响应：
```json
{
  "url": "https://images.unsplash.com/photo-xxx?w=1920&h=1080&fit=crop",
  "id": "photo-id",
  "description": "Photo description",
  "author": {
    "name": "Author Name",
    "username": "author_username",
    "link": "https://unsplash.com/@author_username"
  },
  "links": {
    "unsplash": "https://unsplash.com/photos/xxx",
    "download": "https://api.unsplash.com/photos/xxx/download"
  },
  "color": "#0c0c0c",
  "blur_hash": "xxx"
}
```

### 搜索图片

```
GET /search?query=nature&page=1&per_page=10&orientation=landscape
```

### 获取指定图片

```
GET /photo/:id
```

### 健康检查

```
GET /health
```

## 部署

### 1. 获取 Unsplash API Key

1. 访问 [Unsplash Developers](https://unsplash.com/developers)
2. 创建新应用
3. 获取 Access Key

### 2. 安装依赖

```bash
cd unsplash-proxy
npm install
```

### 3. 配置 Secrets

```bash
npx wrangler secret put UNSPLASH_ACCESS_KEY
# 输入你的 Unsplash Access Key
```

### 4. 本地开发

```bash
npm run dev
```

访问 http://localhost:8787

### 5. 部署到 Cloudflare Workers

```bash
npm run deploy
```

部署成功后会得到一个 URL，如：
`https://vstats-unsplash-proxy.your-account.workers.dev`

## 在 vStats 中使用

Worker 部署后，vStats 服务端会自动使用它来获取 Unsplash 图片。

默认 Proxy URL：`https://vstats-unsplash-proxy.zsai001.workers.dev`

## 速率限制

Unsplash API 免费版限制：
- Demo 应用：50 requests/hour
- Production 应用：5000 requests/hour

建议申请 Production 状态以获得更高的限额。

## 缓存策略

- 随机图片：5分钟缓存
- 搜索结果：5分钟缓存
- 指定图片：无缓存（通常是一次性请求）

## 故障回退

当 Unsplash API 不可用时，会返回 Picsum 作为备用图片源：

```json
{
  "url": "https://picsum.photos/1920/1080",
  "fallback": true,
  "error": "Unsplash API error: 403"
}
```
