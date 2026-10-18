import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Each fly-to costs ~1.5-4s of wall-clock on a software-rendered (GPU-
  // less) canvas — the 900ms flight plus several hundred ms per frame —
  // and the multi-flight tests chain five or six of them. 60s leaves room
  // for a fully parallel local run, where every worker is CPU-starved.
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  // No retries locally: every wait in e2e/ is on observable scene state
  // (see e2e/support/scene.ts), so a failure is a real signal, and a retry
  // would only hide a new flake. One on CI, purely as insurance against
  // shared-runner hiccups outside the app (a dev server slow to answer, a
  // GPU-less runner stalling a frame for seconds) — and it's what makes
  // `trace: 'on-first-retry'` below record anything at all. A test that
  // only passes on retry still shows up as "flaky" in the report.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  // On CI: inline annotations on the PR plus an HTML report the workflow
  // uploads as an artifact on failure. Locally: just the HTML report.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
  use: {
    // A retried test records a trace (DOM snapshots, console, network) into
    // test-results/ — the only way to see what a CI-only failure looked like.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'npm run dev',
      cwd: './examples/basic',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      cwd: './examples/with-models',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
