# Poetry Garden API - Cloudflare Workers

## 项目结构

```
cloudflare-backend/
├── src/
│   ├── index.ts           # 主入口
│   └── routes/
│       ├── poems.ts       # 诗词 API
│       ├── authors.ts     # 作者 API
│       ├── auth.ts        # 认证 API
│       ├── collections.ts # 收藏 API
│       └── convert.ts     # 简繁转换 API
├── schema.sql             # D1 数据库 schema
├── wrangler.toml          # Wrangler 配置
├── migrate.ts             # 数据迁移脚本
└── package.json
```

## 部署步骤

### 1. 创建 D1 数据库

```bash
# 创建 D1 数据库
wrangler d1 create poetry-garden

# 创建本地 D1 数据库（用于开发）
wrangler d1 create poetry-garden --local
```

### 2. 更新 wrangler.toml

将 `database_id` 替换为实际创建的数据库 ID：

```toml
[[d1_databases]]
binding = "DB"
database_name = "poetry-garden"
database_id = "实际数据库ID"
```

### 3. 执行数据库迁移

```bash
# 创建表结构
wrangler d1 execute poetry-garden --file=./schema.sql

# 验证表创建成功
wrangler d1 execute poetry-garden --command="SELECT name FROM sqlite_master WHERE type='table'"
```

### 4. 部署到 Cloudflare Workers

```bash
# 部署
wrangler deploy

# 开发模式（本地测试）
wrangler dev
```

### 5. 测试 API

```bash
# 测试健康检查
curl https://poetry-garden-api.你的账号.workers.dev/api/health

# 测试获取诗词列表
curl https://poetry-garden-api.你的账号.workers.dev/api/poems

# 测试随机诗词
curl https://poetry-garden-api.你的账号.workers.dev/api/poems/random
```

## API 端点

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | /api/health | 健康检查 |
| GET | /api/poems | 诗词列表（支持分页、筛选） |
| GET | /api/poems/:id | 获取单个诗词 |
| GET | /api/poems/random | 随机诗词 |
| GET | /api/poems/search | 搜索诗词 |
| GET | /api/authors | 作者列表 |
| GET | /api/authors/:id | 作者详情（含作品） |
| POST | /api/auth/register | 注册 |
| POST | /api/auth/login | 登录 |
| GET | /api/collections | 收藏列表 |
| POST | /api/collections | 添加收藏 |
| DELETE | /api/collections/:id | 删除收藏 |
| POST | /api/convert | 简繁转换 |

## 环境变量

在 Cloudflare Workers 控制台设置：

- `API_VERSION`: API 版本号
