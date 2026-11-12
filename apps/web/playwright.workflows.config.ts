import { defineConfig, devices } from '@playwright/test';

// Workflow browser tests (audit 11 Nov 2026, finding 17). Unlike the smoke test (playwright.config.ts, sample build, no database), these
// run the real app: the API on Wrangler's local runtime and the web app, both against a throwaway LOCAL Supabase seeded by
// scripts/e2e-seed.mjs. People sign in with a password and click through real work; the database's approval and company rules apply.
// CI: .github/workflows/workflow-tests.yml. It needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (in the repo-root .env for the web app),
// E2E_PASSWORD, and the API's variables passed on the Wrangler command line below.
const supabaseUrl = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

export default defineConfig({
  testDir: './e2e-workflows',
  testMatch: '**/*.e2e.ts',
  timeout: 120_000,
  retries: 0,
  workers: 1, // the tests share one seeded database and run in order
  fullyParallel: false,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: [
    {
      command: [
        'node ../../node_modules/wrangler/bin/wrangler.js dev --port 8787',
        '--var APP_ENV:test --var ALLOWED_ORIGINS:http://localhost:5173',
        `--var SUPABASE_URL:${supabaseUrl}`,
        `--var SUPABASE_PUBLISHABLE_KEY:${process.env.SUPABASE_PUBLISHABLE_KEY ?? ''}`,
      ].join(' '),
      cwd: '../api',
      url: 'http://localhost:8787/health',
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: 'node ../../node_modules/vite/bin/vite.js --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
