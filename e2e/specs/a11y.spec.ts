import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { login, waitForDashboardReady } from '../helpers'

/**
 * 可访问性规格（计划 Phase 3.4 回归闸门）：
 * axe-core WCAG 2.2 A/AA 扫描，桌面 1920×1080 与移动 390×844 双尺寸。
 * 阈值：serious / critical 违规必须为 0（与 CLAUDE.md 审查清单一致）；
 * moderate 违规以附件形式记录，供持续修复跟踪。
 */
for (const viewport of [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test.describe(`a11y @ ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('axe 扫描无 serious/critical 违规', async ({ page }, testInfo) => {
      await login(page)
      await waitForDashboardReady(page)
      // 等待图表/面板渲染稳定后再扫描
      await page.waitForTimeout(800)

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        // 第三方地图容器内 DOM（高德 iframe 为跨源，axe 自动跳过；此处排除其外围包装）
        .analyze()

      const blocking = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      )
      const summary = results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
        help: violation.help,
      }))
      testInfo.attach(`${viewport.name}-axe-violations`, {
        body: JSON.stringify(summary, null, 2),
        contentType: 'application/json',
      })
      expect(
        blocking,
        `axe serious/critical 违规:\n${JSON.stringify(blocking, null, 2)}`,
      ).toEqual([])
    })
  })
}
