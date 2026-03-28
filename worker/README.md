# Pixel Rhythm - Cloudflare Workers 云同步部署指南

## 前提条件
- 已有 Cloudflare 账号（你已经在用 Cloudflare Pages）
- 安装 Node.js 16+
- 安装 Wrangler CLI: `npm install -g wrangler`

## 第一步：登录 Wrangler

```bash
wrangler login
```

浏览器会弹出授权页面，点击允许。

## 第二步：创建 D1 数据库

```bash
cd worker
wrangler d1 create pixel-rhythm-db
```

命令输出会显示一个 `database_id`，类似：
```
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**把这个 ID 复制到 `worker/wrangler.toml` 中替换 `YOUR_D1_DATABASE_ID`。**

## 第三步：初始化数据库表

```bash
wrangler d1 execute pixel-rhythm-db --file=schema.sql
```

## 第四步：部署 Workers

```bash
wrangler deploy
```

部署成功后，会输出 Workers URL，类似：
```
https://pixel-rhythm-api.your-subdomain.workers.dev
```

## 第五步：更新前端配置

打开 `js/cloud.js`，找到第 7 行：
```javascript
const API_BASE = 'https://pixel-rhythm-api.YOUR_SUBDOMAIN.workers.dev';
```

替换为你的实际 Workers URL。

## 第六步：部署前端

把更新后的代码推送到 GitHub，Cloudflare Pages 会自动部署。

```bash
git add .
git commit -m "feat: replace Firebase with Cloudflare Workers cloud sync"
git push
```

## 验证

1. 打开游戏页面
2. 点击「☁ 云同步」按钮
3. 点击「创建云存档」
4. 应该显示「已连接云端」

## 免费额度

| 资源 | 免费额度 | 预估消耗 |
|------|---------|---------|
| Workers 请求 | 10万次/天 | ~100次/活跃用户/天 |
| D1 读取 | 500万次/天 | ~50次/活跃用户/天 |
| D1 写入 | 10万次/天 | ~20次/活跃用户/天 |
| D1 存储 | 5 GB | ~1KB/用户 |

**结论：免费额度可支撑数千活跃用户。**

## 自定义域名（可选）

如果想让 API 用自己的域名：

1. Cloudflare Dashboard → Workers → pixel-rhythm-api → Triggers
2. Add Custom Domain → 输入如 `api.your-domain.com`
3. 更新 `js/cloud.js` 中的 `API_BASE`
