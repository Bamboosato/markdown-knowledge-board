import { defineConfig, devices } from '@playwright/test'

const port = process.env.PLAYWRIGHT_PORT ?? '4177'
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/pwa.spec.ts',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  expect: {
    timeout: 8_000,
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    serviceWorkers: 'allow',
  },
  webServer: {
    command: `npm run build:pwa:test && node tests/fixtures/pwa-version-server.mjs`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'pwa-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
})
