---
name: proud-yawning-walrus
description: Production-grade upgrade of the drone low-altitude command dashboard — full frontend interaction, aesthetics, big-screen adaptation (16:9-48:9), map, CSP, and resilience
---

## Context

The current dashboard is functional but does not meet the acceptance criteria in the FDE requirement document (basemap switching, multi-resolution adaptation, data freshness, accessibility). The reference screenshot shows a real GIS basemap, yet the current OperationsMap.vue uses only CSS-drawn fake terrain. The design doc explicitly requires CSS Grid + container queries + controlled scaling (no transform:scale), rem-based typography, and WCAG AA contrast. The current codebase is a single 87-line monolith, missing fonts, frozen data, no reconnect, and failing contrast. This upgrade makes the application deliverable.

## Recommended Approach

- Split main.scss into tokens + per-component scoped styles (co-locate bug-prone classes).
- Use two stepped scales: --root-size (rem) and --density (padding/row heights).
- Replace fake map with MapLibre GL JS + TianDiTu (primary) or AMap (fallback) raster tiles; add WGS84↔GCJ-02 transform; keep offline canvas fallback.
- Wire all panels to usePolledResource (reuse @vueuse/core) and useAircraftStream (hand-rolled for backoff/jitter/401).
- Rewrite PanelShell to preserve last-good data on error + staleness badge.
- Add CSP to nginx.conf, fix header "首页" button, expose dropped fields, add Playwright multi-resolution E2E gate.

Critical files (representative):
- apps/web/src/styles/main.scss (decompose into _tokens/ _density/ layout/ _a11y/)
- apps/web/src/components/OperationsMap.vue (replace with MapLibre feature)
- apps/web/src/views/DashboardView.vue (grid reflow, composables)
- apps/api/src/app.ts (shared ticker, client-config, stream ticket, CSP)
- apps/web/nginx.conf (CSP + tile origins)
- apps/web/src/features/map/ (providers.ts, coords.ts, useMapInstance.ts)

Verification:
- Run `npm run build` and check gzip size ≤ 350 KB.
- Playwright matrix at 1920×1080 / 2560×1080 / 3440×1440 / 3840×2160 / 5120×1440 / 7680×1440 / 1920×900.
- Screenshot review + axe-core scan.
- Manual: tiles blocked (offline fallback), token expired, API stopped 2 min.

## Implementation Status (2026-08-12)

| Capability | Status | Current implementation |
|---|---|---|
| Visual system and density | Complete | Color/spacing/type tokens plus stepped root-size and density rules |
| Responsive command layout | Complete | Desktop, ultrawide, 1250px reflow, and 820px mobile stack without transform scaling |
| Production map | Complete | AMap JS API with satellite/vector/dark modes, live markers, no-fly polygons, and local fallback |
| Data freshness | Complete | 30-second polling, last-good-data retention, stale badge, and manual retry |
| Realtime resilience | Complete | SSE reconnect with capped exponential backoff plus online/visibility recovery |
| Accessibility | Complete | Semantic controls, chart description, focus treatment, 44px mobile targets, reduced motion |
| Security headers | Complete | Nginx CSP scoped for same-origin application and required AMap resource domains |
| Scenario interactions | Complete | Dispatch, work-order lifecycle, equipment health, alert drawer, and map positioning |
| Automated multi-resolution E2E | Complete | Playwright matrix at 1920×1080 / 2560×1080 / 3440×1440 / 3840×2160 / 5120×1440 / 7680×1440 / 1920×900 / 1440×900 / 390×844 with axe-core scans, resilience specs (map-CDN fallback, token expiry, SSE reconnect), CI workflow |

## Verification Baseline

- `npm run typecheck`
- `npm test`
- `npm run build`（gzip 232 KB ≤ 350 KB）
- `npm audit --omit=dev --audit-level=high`
- `docker compose config --quiet`
- `npm run e2e`：15/15 通过（11.2s，本地）—— 多分辨率布局矩阵 + 断点重排 + axe（A/AA，桌面/移动 serious/critical 0 违规，桌面全量违规 0）+ 韧性场景（地图 CDN 阻断→演示底图回退；Token 过期→401 清理会话回登录页；SSE 链路中断→链路重连徽标→退避重连恢复）
- Browser acceptance at 1440x900 and 390x844, including overflow and console checks（已纳入自动化矩阵）

### E2E harness（2026-08-13 引入，随 CI 交付）

- `e2e/playwright.config.mts`：双 webServer（API :3000 + Vite :5173，本地复用已有服务），chromium，失败留 trace
- `e2e/specs/dashboard.spec.ts`：7 分辨率计划矩阵 + 1440×900 + 390×844，断言登录→渲染→无横向溢出→底图三模式切换→标记选中态 popover→控制台干净→截图留档（`e2e/results/screenshots/`）
- `e2e/specs/a11y.spec.ts`：axe-core WCAG 2.2 A/AA，serious/critical 必须为 0，moderate 以附件记录
- `e2e/specs/resilience.spec.ts`：三场景韧性回归
- `.github/workflows/ci.yml`：verify（typecheck/test/build/audit/compose）+ e2e 矩阵双 job
- Playwright 为根 devDependency；Docker 构建走 `npm ci --ignore-scripts`，浏览器不下载、运行时镜像不受影响；`e2e/results` 等产物已排除出 Docker 上下文
