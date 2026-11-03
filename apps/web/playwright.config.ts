import { defineConfig, devices } from '@playwright/test';

// Browser smoke test (system audit 2026-11-03, finding 6). Runs against the sample build (`vite --mode demo`: no sign-in, data in
// the browser, nothing saved), so it needs no secrets and touches no database. Files are *.e2e.ts so Vitest does not pick them up.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 240_000,
  retries: process.env.CI ? 1 : 0,
  // The sample build runs on Vite's dev server (unbundled); four browsers at once overload it and pages time out. Two locally, one in CI.
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: { baseURL: 'http://localhost:5199', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node ../../node_modules/vite/bin/vite.js --mode demo --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
