import { expect, test } from '@playwright/test'
import { collectConsoleErrors, expectNoHorizontalOverflow, login, RESOLUTIONS, waitForDashboardReady } from '../helpers'

/**
 * 布局矩阵规格（计划 Phase 3.6）：
 * 每个分辨率下验证 —— 登录 → 大屏渲染 → 面板就绪 → 无横向溢出 → 底图三模式切换
 * → 飞机标记选中态 → 控制台无未允许错误 → 截图留档。
 */
for (const resolution of RESOLUTIONS) {
  test.describe(`dashboard @ ${resolution.name}`, () => {
    test.use({ viewport: { width: resolution.width, height: resolution.height } })

    test('大屏渲染 · 无横向溢出 · 底图切换 · 选中态', async ({ page }, testInfo) => {
      const consoleErrors = collectConsoleErrors(page)
      await login(page)
      await waitForDashboardReady(page)
      await expectNoHorizontalOverflow(page)

      // 顶栏关键要素：时钟 + 链路状态 + 全屏按钮 + 作业台入口
      await expect(page.locator('.connection')).toContainText('链路正常')
      await expect(page.locator('button[title="全屏"]')).toBeVisible()
      await expect(page.locator('[aria-label="进入作业工作台"]')).toBeVisible()

      // 地图状态徽标（高德 ready 或 演示底图 fallback 均合法）
      const mapStatus = page.locator('.map-status')
      await expect(mapStatus).toBeVisible()
      const statusText = (await mapStatus.textContent()) ?? ''
      expect(statusText).toMatch(/高德地图|演示底图|地图服务不可用/)

      // 底图三模式切换（卫星 / 电子 / 暗色）
      const satellite = page.locator('button[title="卫星图"]')
      const vector = page.locator('button[title="电子地图"]')
      const dark = page.locator('button[title="暗色地图"]')
      await satellite.click()
      await expect(satellite).toHaveClass(/active/)
      await vector.click()
      await expect(vector).toHaveClass(/active/)
      await dark.click()
      await expect(dark).toHaveClass(/active/)

      // 飞机标记 → 选中态 popover（AMap 标记容器绝对定位且相邻重叠，点击动作被上层容器拦截，
      // 直接触发按钮的 click 处理器，等价于用户点中标记本体）
      const marker = page.locator('.amap-aircraft-marker, .aircraft-marker').first()
      await marker.evaluate((el) => (el as HTMLButtonElement).click())
      await expect(page.locator('.aircraft-popover')).toBeVisible()
      await expect(page.locator('.aircraft-popover')).toContainText('飞行高度')

      // 禁飞区图例与缩放工具可达（图例在 ≤820px 移动布局按设计隐藏）
      if (resolution.width > 820) {
        await expect(page.locator('.map-legend')).toBeVisible()
      } else {
        await expect(page.locator('.map-legend')).toBeHidden()
      }
      await expect(page.locator('button[title="放大"]')).toBeVisible()

      consoleErrors.expectClean()
      await page.screenshot({
        path: `e2e/results/screenshots/${resolution.name}-dashboard.jpeg`,
        type: 'jpeg',
        quality: 60,
        fullPage: false,
      })
      testInfo.attach(`${resolution.name}-dashboard`, {
        body: await page.screenshot({ type: 'jpeg', quality: 60 }),
        contentType: 'image/jpeg',
      })
    })
  })
}

/** 断点行为：≤1250px 两栏重排、≤820px 单列纵向，均禁止横向滚动 */
test.describe('dashboard @ breakpoints', () => {
  test.use({ viewport: { width: 1000, height: 800 } })
  test('1000px 两栏重排无横向溢出', async ({ page }) => {
    await login(page)
    await waitForDashboardReady(page)
    await expectNoHorizontalOverflow(page)
  })
})
