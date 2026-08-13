import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

/**
 * 无人机低空指挥调度平台 · 多分辨率 E2E 配置
 * 依据计划（proud-yawning-walrus）验证矩阵：
 * 1920×1080 / 2560×1080 / 3440×1440 / 3840×2160 / 5120×1440 / 7680×1440 / 1920×900
 * 另含验证基线中的 1440×900 与移动端 390×844。
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 轻量 .env 加载（不引入 dotenv 依赖）：供测试读取 ADMIN_USERNAME / ADMIN_PASSWORD
for (const line of readFileSync(resolve(root, '.env'), 'utf8').split('\n')) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].trim()
}

const API_BASE = process.env.E2E_API_URL ?? 'http://127.0.0.1:3000'
const WEB_BASE = process.env.E2E_WEB_URL ?? 'http://127.0.0.1:5173'

export default defineConfig({
  testDir: resolve(root, 'e2e/specs'),
  outputDir: resolve(root, 'e2e/results/output'),
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : 4,
  reporter: [['list'], ['html', { outputFolder: resolve(root, 'e2e/results/report'), open: 'never' }]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: WEB_BASE,
    headless: true,
    colorScheme: 'dark',
    locale: 'zh-CN',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: [
    {
      command: 'npm run dev:api',
      url: `${API_BASE}/api/v1/auth/captcha`,
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      env: { NODE_ENV: 'test' },
    },
    {
      command: 'npm run dev:web',
      url: WEB_BASE,
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
    },
  ],
})
