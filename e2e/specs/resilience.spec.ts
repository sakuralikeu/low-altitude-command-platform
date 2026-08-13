import { expect, test } from '@playwright/test'
import { login, waitForDashboardReady } from '../helpers'

/**
 * 韧性规格（计划 Phase 2.3 / 验证基线"手动"场景的自动化落地）：
 * 1. 地图 CDN 被阻断 → 离线演示底图回退 + 状态提示 + 重试按钮
 * 2. Token 过期 → 任意 API 401 → 会话清理并重定向登录页
 * 3. 网络断连/恢复 → 链路徽标「链路重连」↔「链路正常」+ SSE 自动重连
 */
test.describe('resilience @ 1920x1080', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('地图 CDN 阻断 → 演示底图回退', async ({ page, context }) => {
    // 阻断高德 JS API CDN（模拟离线/域名被墙）
    await context.route('https://webapi.amap.com/**', (route) => route.abort())
    await login(page)

    await expect(page.locator('.map-loading.map-error')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.map-loading.map-error')).toContainText('已切换演示底图')
    // 回退底图仍渲染飞机标记与状态徽标
    await expect(page.locator('.aircraft-marker').first()).toBeVisible()
    await expect(page.locator('.map-status')).toContainText('地图服务不可用')
    // 重试按钮存在（恢复链路后可用）
    await expect(page.locator('button.map-retry')).toBeVisible()
  })

  test('Token 过期 → 401 清理会话并回到登录页', async ({ page }) => {
    await login(page)
    await waitForDashboardReady(page)

    await page.evaluate(() => sessionStorage.setItem('access_token', 'expired.invalid.token'))
    await page.click('button[aria-label="刷新数据"]')

    await page.waitForURL((url) => url.pathname === '/login')
    await expect(page.locator('h2', { hasText: '登录运行控制台' })).toBeVisible()
    const token = await page.evaluate(() => sessionStorage.getItem('access_token'))
    expect(token).toBeNull()
  })

  test('链路中断 → 链路重连 · 恢复 → 退避重连在线', async ({ page }) => {
    // CDP 离线模拟不会中断已建立的 SSE 连接；改用路由拦截 abort 等价于链路中断：
    // EventSource 建立失败 → 链路重连徽标 + 指数退避重连 → 拦截解除后自动恢复
    await page.route('**/api/v1/realtime/aircraft**', (route) => route.abort())
    await login(page)
    await expect(page.locator('.connection')).toContainText('链路重连', { timeout: 30_000 })
    await expect(page.locator('.map-status')).toContainText('链路重连', { timeout: 30_000 })

    await page.unroute('**/api/v1/realtime/aircraft**')
    await expect(page.locator('.connection')).toContainText('链路正常', { timeout: 60_000 })
    await expect(page.locator('.map-status')).toContainText('遥测在线', { timeout: 60_000 })
  })
})
