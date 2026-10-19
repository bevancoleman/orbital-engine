import { defineConfig, devices } from '@playwright/test'

// Ports are fixed (and strict) in each example's vite.config.ts for both
// `vite` and `vite preview`; the specs hardcode the same URLs.
const EXAMPLES = [
  { dir: 'basic', port: 5173 },
  { dir: 'with-models', port: 5174 },
] as const

// CI tests what actually ships: a production `vite build` served by
// `vite preview` (minified, production React, assets out of dist/ rather
// than vite's on-the-fly transforms). The e2e job in ci.yml runs the
// builds as explicit steps, so here CI only starts `vite preview`.
// Locally the dev server stays the default: it starts instantly and
// `reuseExistingServer` picks up one you already have running.
// E2E_PREVIEW=1 reproduces the CI setup locally, building first.
function serverCommand(): string {
  if (process.env.CI) return 'npm run preview'
  if (process.env.E2E_PREVIEW) return 'npm run build && npm run preview'
  return 'npm run dev'
}

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
  webServer: EXAMPLES.map(({ dir, port }) => ({
    command: serverCommand(),
    cwd: `./examples/${dir}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    // Room for E2E_PREVIEW's build step; dev and plain preview take ~1s.
    timeout: 120_000,
    // An empty GITHUB_PAGES keeps vite's `base` at '/' (see each example's
    // vite.config.ts), so BASE_URL, which examples/with-models builds its
    // asset URLs from, matches the root URLs the specs navigate to. The CI
    // build steps run without it too (see the e2e job in ci.yml).
    env: { GITHUB_PAGES: '' },
  })),
})
