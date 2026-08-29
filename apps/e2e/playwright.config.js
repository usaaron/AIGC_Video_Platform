import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'

const webPort = Number(process.env.SEQORA_E2E_WEB_PORT || 6173)
const adminPort = Number(process.env.SEQORA_E2E_ADMIN_PORT || 6174)
const chromiumExecutable = findChromiumExecutable()
const browserLaunch = chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: `pnpm --filter @seqora/web dev --host 127.0.0.1 --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @seqora/admin dev --host 127.0.0.1 --port ${adminPort}`,
      url: `http://127.0.0.1:${adminPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'web',
      testMatch: /[\\/]tests[\\/]web[\\/].*\.spec\.js$/,
      use: {
        ...devices['Desktop Chrome'],
        ...browserLaunch,
        baseURL: `http://127.0.0.1:${webPort}`,
      },
    },
    {
      name: 'admin',
      testMatch: /[\\/]tests[\\/]admin[\\/].*\.spec\.js$/,
      use: {
        ...devices['Desktop Chrome'],
        ...browserLaunch,
        baseURL: `http://127.0.0.1:${adminPort}`,
      },
    },
  ],
})

function findChromiumExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROMIUM_EXECUTABLE_PATH,
    'C:/Users/Admin/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe',
    'C:/Users/Admin/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
    'C:/Users/Admin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}
