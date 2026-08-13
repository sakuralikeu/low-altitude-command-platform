import { expect, test } from '@playwright/test'
import { collectConsoleErrors, login } from '../helpers'

/**
 * 作业工作台规格（大屏/作业分离后）：
 * 大屏入口跳转、导航结构、各功能面板可用、数据问答暂缓、角色守卫。
 */
test.describe('workspace @ 1920x1080', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('大屏 → 工作台 → 各功能面板切换可用 → 返回大屏', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page)
    await login(page)

    // 大屏右列已瘦身为纯展示页签
    const dashTabs = await page.locator('.panel-tabs button').allTextContents()
    expect(dashTabs).toEqual(['任务排行', '飞行分析'])

    await page.click('[aria-label="进入作业工作台"]')
    await page.waitForURL('**/workspace')
    const navs = await page.locator('.workbench-nav-item').allTextContents()
    expect(navs.length).toBe(5)
    expect(navs[4]).toContain('数据问答')
    // 数据问答为暂缓项，禁用
    await expect(page.locator('.workbench-nav-item', { hasText: '数据问答' })).toBeDisabled()

    // 智能调度（默认）+ 作业地图
    await expect(page.locator('.panel-shell h2')).toContainText('智能调度推荐')
    await expect(page.locator('.dispatch-form')).toBeVisible()
    await expect(page.locator('.workbench-map')).toBeVisible()
    await expect(page.getByRole('button', { name: '执行智能派发' })).toBeVisible()
    await page.getByRole('button', { name: '执行智能派发' }).click()
    await expect(page.getByRole('button', { name: '确认执行智能派发' })).toBeVisible()
    await page.getByRole('button', { name: '取消派发' }).click()

    // 工单闭环
    await page.locator('.workbench-nav-item', { hasText: '工单闭环' }).click()
    await expect(page.locator('.panel-shell h2')).toContainText('巡检工单闭环')
    await expect(page.locator('.workorder-list li').first()).toBeVisible({ timeout: 10_000 })

    // 设备健康
    await page.locator('.workbench-nav-item', { hasText: '设备健康' }).click()
    await expect(page.locator('.panel-shell h2')).toContainText('设备健康与维护预测')
    await expect(page.locator('.health-list li').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /生成保养工单/ }).first()).toBeVisible()

    // AI 事件处置
    await page.locator('.workbench-nav-item', { hasText: 'AI 事件处置' }).click()
    await expect(page.locator('.demo-badge')).toContainText('演示数据 · 待接入识别模型')
    await expect(page.locator('.ai-event-list li').first()).toBeVisible({ timeout: 10_000 })
    // 查看详情抽屉
    await page.locator('.ai-event-list li').first().getByRole('button', { name: '详情' }).click()
    await expect(page.locator('.event-detail-drawer')).toBeVisible()
    await expect(page.locator('.event-detail-drawer .event-facts')).toContainText('发生位置')
    await expect(page.locator('.event-timeline li')).toHaveCount(3)
    await page.locator('.event-detail-drawer .drawer-close').click()
    await expect(page.locator('.event-detail-drawer')).toHaveCount(0)

    // 返回大屏
    await page.click('[aria-label="返回指挥大屏"]')
    await page.waitForURL((url) => url.pathname === '/')
    await expect(page.locator('.map-status')).toBeVisible()
    consoleErrors.expectClean()
  })

  test('仅大屏查看角色访问工作台被重定向回大屏', async ({ page }) => {
    await login(page)
    await page.evaluate(() => sessionStorage.setItem('user_roles', JSON.stringify(['dashboard.viewer'])))
    await page.goto('/workspace')
    await page.waitForURL((url) => url.pathname === '/')
    await expect(page.locator('.map-status')).toBeVisible()
    await expect(page.getByText('当前账号仅可查看态势')).toBeVisible()
  })
})
