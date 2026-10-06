import { defineConfig } from '@playwright/test'
import base from './playwright.config'

const server = base.webServer
if (!server || Array.isArray(server)) throw new Error('CI smoke requires one configured web server')

export default defineConfig({
  ...base,
  grep: /@ci-smoke/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['./tests/fixtures/ci-reporter.ts', { scope: 'smoke', expected: 14 }],
  ],
  use: { ...base.use, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { ...server, reuseExistingServer: false },
  projects: base.projects?.filter((project) => project.name === 'chromium'),
})
