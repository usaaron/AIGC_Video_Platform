import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'node scripts/start-dev-app.mjs',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { ...process.env, APP_PACKAGE: '@seqora/web', SKIP_CONTRACTS_BUILD: 'true' },
    },
    {
      command: 'node scripts/start-dev-app.mjs',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { ...process.env, APP_PACKAGE: '@seqora/admin', SKIP_CONTRACTS_BUILD: 'true' },
    },
  ],
})
