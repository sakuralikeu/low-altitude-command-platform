import type { ConsoleMessage, Page } from '@playwright/test'
import { expect } from '@playwright/test'

/** 计划（proud-yawning-walrus）要求的多分辨率矩阵 */
export const RESOLUTIONS: Array<{ name: string; width: number; height: number }> = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '2560x1080', width: 2560, height: 1080 },
  { name: '3440x1440', width: 3440, height: 1440 },
  { name: '3840x2160', width: 3840, height: 2160 },
  { name: '5120x1440', width: 5120, height: 1440 },
  { name: '7680x1440', width: 7680, height: 1440 },
  { name: '1920x900', width: 1920, height: 900 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 },
]

export const CREDENTIALS = {
  username: process.env.ADMIN_USERNAME ?? 'admin',
  password: process.env.ADMIN_PASSWORD ?? 'change-me-before-deploy',
}

/**
 * 控制台噪音收集器：只放行已知无害消息
 * - 第三方地图 CDN（webapi/restapi.amap.com）资源偶发失败、SDK 内部竞态未捕获错误
 *   （pageerror 的 message 不含域名，需连同 stack 一起匹配）
 * - 开发服务器热重启时的 SSE 分块中断（仅 dev 场景）
 * 其余 console.error / pageerror 一律计入失败。
 */
export function collectConsoleErrors(page: Page) {
  const errors: string[] = []
  const allowed = [/amap\.com/, /ERR_INCOMPLETE_CHUNKED_ENCODING/]
  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return
    const location = msg.location().url || ''
    const text = msg.text()
    if (allowed.some((pattern) => pattern.test(location) || pattern.test(text))) return
    errors.push(`console.error: ${text} @ ${location}`)
  }
  const onPageError = (error: Error) => {
    const stack = error.stack ?? ''
    if (allowed.some((pattern) => pattern.test(error.message) || pattern.test(stack))) return
    errors.push(`pageerror: ${error.message}`)
  }
  page.on('console', onConsole)
  page.on('pageerror', onPageError)
  return {
    expectClean() {
      expect(errors, '页面不应出现未允许的控制台错误').toEqual([])
    },
  }
}

/** 读取验证码 challenge（登录页渲染在 button.captcha b 内），完成真实登录流程 */
export async function login(page: Page) {
  await page.goto('/login')
  await expect(page.locator('h2', { hasText: '登录运行控制台' })).toBeVisible()
  await page.waitForFunction(() => {
    const el = document.querySelector('button.captcha b')
    return Boolean(el && /^\d{4}$/.test((el.textContent ?? '').trim()))
  })
  const captcha = (await page.textContent('button.captcha b'))!.trim()
  await page.fill('input[placeholder="请输入用户名"]', CREDENTIALS.username)
  await page.fill('input[placeholder="请输入密码"]', CREDENTIALS.password)
  await page.fill('input[aria-label="验证码"]', captcha)
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/'),
    page.click('button.login-submit'),
  ])
  await expect(page.locator('h1', { hasText: '无人机低空指挥调度平台' })).toBeVisible()
}

/** 等面板三态就绪：核心面板标题 + 遥测连接 + 地图标记出现 */
export async function waitForDashboardReady(page: Page) {
  await expect(page.locator('.panel-shell h2', { hasText: '飞行总览' })).toBeVisible()
  await expect(page.locator('.panel-shell h2', { hasText: '飞行任务排行榜' })).toBeVisible()
  await expect(page.locator('.connection')).toContainText('链路正常', { timeout: 30_000 })
  // 飞机标记：高德模式 .amap-aircraft-marker / 演示模式 .aircraft-marker
  await expect(page.locator('.amap-aircraft-marker, .aircraft-marker').first()).toBeVisible({ timeout: 30_000 })
}

/** 横向溢出检查：任何分辨率下禁止横向滚动（计划验收标准） */
export async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    innerWidth: window.innerWidth,
  }))
  expect(
    metrics.scrollWidth,
    `横向溢出：scrollWidth=${metrics.scrollWidth} > innerWidth=${metrics.innerWidth}`,
  ).toBeLessThanOrEqual(metrics.innerWidth + 1)
}
