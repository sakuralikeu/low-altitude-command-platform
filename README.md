# 无人机低空指挥调度平台

Vue 3 + TypeScript 大屏、Node.js BFF 与 Docker Compose 部署。

## 本地 Docker 启动

```bash
cp .env.example .env
# 修改 .env 中的 ADMIN_PASSWORD 和 JWT_SECRET
docker compose up -d --build
```

访问 `http://localhost:8080`。用户名默认为 `admin`，密码来自 `.env` 的 `ADMIN_PASSWORD`。

## 高德地图

中央态势区支持高德地图 Web JS API 2.0（暗色 / 电子 / 卫星三种底图）。启用步骤：

1. 打开 [高德开放平台](https://console.amap.com/) →「应用管理」→「我的应用」→ 创建应用；
2. 在应用中创建 **Web 端（JS API）** 类型的 Key；
3. 将该 Key 的**域名白名单**加入你的访问域名（本地联调需包含 `localhost`；Docker 部署按 `PUBLIC_PORT` 填入，如 `http://localhost:8080`）；
4. 获取 **安全密钥（securityJsCode）**，写入 `.env`：

```bash
VITE_AMAP_KEY=your-web-js-api-key
VITE_AMAP_SECURITY_CODE=your-security-code
```

5. 重新执行 `docker compose up -d --build`（构建时注入前端）。

未配置 Key 时平台自动降级为本地演示底图，实时无人机态势、筛选、告警等功能不受影响；地图加载失败时也可手动「重试」。另有可选 `VITE_WEATHER_LABEL` 配置顶部天气播报文案。

## 开发检查

```bash
npm ci
npm run typecheck
npm test
npm run build
```

## 端到端测试（Playwright）

多分辨率布局矩阵 + axe 可访问性扫描 + 韧性场景（地图 CDN 阻断回退 / Token 过期 / SSE 断连重连）：

```bash
npx playwright install chromium   # 首次运行
npm run e2e          # 全量矩阵（自动拉起 API :3000 与 Vite :5173）
npm run e2e:ui       # 交互式调试
npm run e2e:report   # 查看 HTML 报告与截图（e2e/results/）
```

矩阵覆盖：1920×1080 / 2560×1080 / 3440×1440 / 3840×2160 / 5120×1440 / 7680×1440 / 1920×900 / 1440×900 / 390×844，断言无横向溢出、控制台无未允许错误、axe serious/critical 违规为 0。CI 由 `.github/workflows/ci.yml` 承接（verify + e2e 双 job）。

## 远程部署

远端需开启 SSH，并安装 Docker 与 Compose。确认 `.env` 已配置后运行：

```bash
REMOTE_HOST=fengye@192.168.1.136 sh scripts/deploy-remote.sh
```

脚本通过 `docker save/load` 传输本地验证过的镜像，不要求远端访问 npm 或镜像构建源。
