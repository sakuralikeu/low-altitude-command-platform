# CLAUDE.md — 无人机低空指挥调度平台 · 前端设计约束

> 本文件约束本项目所有前端改动。规则来自 Vercel v0 实战设计准则 + 本项目已建立的 token 体系，任何新页面/组件/样式都必须遵守。

## 0. 项目速览

- 栈：Vue 3.5 + TypeScript + Vite + Pinia + ECharts + 高德地图 JS API 2.0 + lucide 图标
- 布局：指挥大屏单页（68px 顶栏 + 三栏 grid + 28px 页脚），暗色主题，`color-scheme: dark`
- 样式：Sass，**只准用 `src/styles/tokens/` 的 CSS 变量**，禁止在组件里写裸 hex（新增色必须先加 token 并标注对比度）
- 适配：`_density.scss` 按屏高缩放密度；断点 1250px / 820px

## 1. 色彩纪律

- 全局 **3 主色 + 灰阶**：`--accent`(teal #45d6aa，主操作/在线) / `--warning`(amber #f2b84b，告警/电量) / `--alert`(red #ff746c，错误/紧急)，辅以 `--blue #79aef2` 仅用于图表第三序列
- **禁止**：紫色渐变、青→紫 AI 默认渐变、彩虹色板、装饰性渐变（面板 KPI 的微弱线性渐变除外，仅限 `--surface` 同族）
- 状态表达**必须多通道**：颜色 + 图标 + 文字（如告警 = amber + AlertTriangle + "告警"），禁止只靠颜色
- 文字层级：`--text`(正文) / `--text-soft`(次级数字) / `--muted`(说明) / `--text-faint`(索引/占位，≥4.5:1 于面板底色，实测 6.2:1)
- 对比度门槛：正文 ≥ 4.5:1，大字/图标 ≥ 3:1；任何新配色先用对比度计算验证

## 2. 字体与数字

- 字体栈固定：`--font-sans`（PingFang SC 系）、`--font-mono`（IBM Plex Mono 栈）。**禁止引入 Inter/Roboto/Arial 等通用字体**
- 所有统计数据必须用 `--font-mono` + `tabular-nums`，单位小号跟随
- 大屏字号层级（保持现状）：面板标题 13px / 主数字 22-24px 等宽 / 说明 9-11px / 眉题 8px 大写等宽（`text-transform: uppercase`）
- 数字显示：整数 `toLocaleString()`，金额/里程保留原数据精度，禁止随意截断

## 3. 布局与密度

- 面板一律走 `PanelShell`（标题 + eyebrow + actions 槽 + loading/error/empty 三态），禁止裸 div 拼面板
- 间距用 `--space-*` token；行高、控制高度遵循 `--density` 缩放
- 网格对齐：同一视觉行内基线对齐；等宽数字列左对齐
- 响应式：桌面三栏 → ≤1250px 两栏（map 右侧）→ ≤820px 单列纵向，**禁止横向滚动**
- 触控目标 ≥ 40×40px（移动端 44×44px）

## 4. 动效

- 时长 150–300ms，`cubic-bezier` 缓出为主；**禁止 `transition: all`**，必须指定属性
- 原则：一次编排精良的入场（staggered reveal）优于散落的微动画；数据变化用 count-up（已有 `useCountUp`）；告警用呼吸脉冲（已有 `beacon`/`marker-pulse` keyframes）
- **必须**尊重 `prefers-reduced-motion`（全局已处理，新动画加在全局动画禁用覆盖范围内）
- 新动画 keyframes 命名有语义（如 `shimmer`/`beacon`），集中在 main.scss，不在组件内散落

## 5. 图标与素材

- 图标只用 lucide-vue-next，**禁止 emoji 当图标**；图标按钮必须有 `title` + `aria-label`
- 按钮/控件：`aria-pressed` 表达选中态（segmented/status-tabs 已如此）
- 地图标记：高德模式与演示模式共用同一套样式类（`.amap-aircraft-marker` / `.aircraft-marker`），新增样式必须两处同步

## 6. 数据展示

- 所有接口数据渲染走类型定义（`src/types.ts`），禁止 any；空态/错误态/加载态由 `PanelShell` 三态承接
- 实时数据（SSE）与轮询（30s）并存：轮询静默刷新不得打断用户交互（排序/筛选状态保留）
- 时间显示统一 `Intl.DateTimeFormat('zh-CN')`；紧凑时间用 `formatRecordTime`
- 百分比带 1 位小数 + 单位；KPI 数字用 `MetricValue`（count-up）

## 7. 演示数据边界

- 演示数据必须在 UI 上可识别（如"演示底图 · 待配置高德 Key"式的标注）；AI 识别类结果一律标注置信度与"演示"来源
- 涉及空域/警务的敏感数据只展示聚合口径，不展示个人级明细

## 8. 审查清单（改完自检）

- [ ] 无裸 hex（全走 token）、无紫色/装饰渐变
- [ ] 对比度达标（正文 4.5:1+）
- [ ] 状态多通道（色+图标+文字）
- [ ] 动效 150-300ms 且支持 reduced-motion，无 `transition: all`
- [ ] 触控/键盘可达，焦点环可见
- [ ] 数字等宽对齐、单位齐全
- [ ] 空态/加载/错误三态齐全
- [ ] 断点 1250/820 下无溢出
