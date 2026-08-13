import { expect, test } from '@playwright/test'
import { collectConsoleErrors, login, waitForDashboardReady } from '../helpers'

/**
 * 独立回放小窗规格：
 * 飞行案例 / 飞行航线 → 脱离地图的模态回放窗（轨迹图 + 播放控件），ESC / X 关闭。
 */
test.describe('replay dialog @ 1920x1080', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('飞行案例点击 → 回放小窗播放推进 → ESC 关闭', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page)
    await login(page)
    await waitForDashboardReady(page)

    await page.locator('button.record-main').first().click()
    const dialog = page.locator('.replay-dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    // 轨迹视图：有高德 Key 时渲染迷你地图，否则回退 SVG 画布，两者均有航线与飞机光标
    await expect(dialog.locator('.replay-track-map, .replay-track-fallback')).toBeVisible()
    await expect(dialog.locator('.replay-map-marker, .track-cursor-plane').first()).toBeVisible({ timeout: 15_000 })
    // 底图切换器：默认卫星（彩色），三态可切
    await expect(dialog.locator('.replay-basemaps button.active')).toContainText('卫星')
    await dialog.locator('.replay-basemaps button[title="切换电子地图"]').click()
    await expect(dialog.locator('.replay-basemaps button.active')).toContainText('电子')
    // 地图内不再出现内嵌回放控制台
    await expect(page.locator('.replay-console')).toHaveCount(0)

    const before = (await dialog.locator('time').textContent()) ?? '0:00'
    await dialog.locator('[aria-label="播放回放"]').click()
    await expect(dialog.locator('[aria-label="暂停回放"]')).toBeVisible()
    await page.waitForTimeout(1300)
    const after = (await dialog.locator('time').textContent()) ?? '0:00'
    expect(after).not.toBe(before)

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    consoleErrors.expectClean()
  })

  test('飞行航线预览 → 计划回放小窗 → X 关闭', async ({ page }) => {
    await login(page)
    await waitForDashboardReady(page)

    await page.click('button[title="查看飞行航线目录"]')
    await page.waitForSelector('.route-actions button:has-text("预览")')
    await page.locator('.route-actions button:has-text("预览")').first().click()

    const dialog = page.locator('.replay-dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog.locator('header span')).toContainText('ROUTE PREVIEW')
    await expect(dialog.locator('[aria-label="播放回放"]')).toBeVisible()
    await expect(dialog.locator('footer')).toContainText('计划航迹 · 不代表实际飞行')
    // 预览启动后航线抽屉应自动关闭，地图不被遮挡
    await expect(page.locator('.alert-drawer')).toHaveCount(0)

    await dialog.locator('[aria-label="关闭回放小窗"]').click()
    await expect(dialog).toHaveCount(0)
  })
})
