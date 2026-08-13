import { defineConfig, devices } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? "5174";
const baseURL = `http://127.0.0.1:${port}`;
const phase2CrossBrowserTests = [
  "**/markdown-edit-assist.spec.ts",
  "**/phase2-auth.spec.ts",
  "**/phase2-backup.spec.ts",
  "**/phase2-restore.spec.ts",
  "**/phase2-production-readiness.spec.ts",
  "**/preview-pdf.spec.ts",
];

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "**/pwa.spec.ts",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "firefox",
      testMatch: phase2CrossBrowserTests,
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "webkit",
      testMatch: phase2CrossBrowserTests,
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
