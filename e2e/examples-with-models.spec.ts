import { test, expect, type Page } from '@playwright/test'

// Regression coverage for CelestialBody.modelUrl (real 3D models) and
// CelestialBody.textureUrl (real surface textures on the built-in sphere) —
// both opt-in per body, both must fall back cleanly to the placeholder
// shape if unset or if loading fails, and neither should ever crash the
// whole scene for one bad body.

function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  return errors
}

test.describe('examples/with-models — real assets', () => {
  test('loads with no console errors, real-assets mode selected by default', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('http://localhost:5174/')
    await page.waitForTimeout(1000)
    await expect(page.locator('canvas')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('flying to bodies with a real model or texture actually fetches it (200, not a silent fallback)', async ({ page }) => {
    const assetRequests: string[] = []
    page.on('response', (r) => {
      if (r.ok() && (r.url().includes('/models/') || r.url().includes('/textures/'))) assetRequests.push(r.url())
    })
    await page.goto('http://localhost:5174/')
    await page.waitForTimeout(500)
    // Fly-to buttons for bodies with a real asset get a trailing " ✓" (see
    // App.tsx) — match by regex rather than the bare label.
    for (const label of ['Saturn', 'ISS', 'Hubble', 'Earth']) {
      await page.getByRole('button', { name: new RegExp(`^${label}\\b`) }).click()
      await page.waitForTimeout(1200)
    }
    expect(assetRequests.some((u) => u.includes('saturn.jpg'))).toBe(true)
    expect(assetRequests.some((u) => u.includes('iss.glb'))).toBe(true)
    expect(assetRequests.some((u) => u.includes('hubble.glb'))).toBe(true)
    expect(assetRequests.some((u) => u.includes('earth.jpg'))).toBe(true)
  })

  test('a body with no real asset (Sun) still renders via the placeholder — no request, no error', async ({ page }) => {
    const errors = trackErrors(page)
    const assetRequests: string[] = []
    page.on('response', (r) => {
      if (r.url().includes('/models/') || r.url().includes('/textures/')) assetRequests.push(r.url())
    })
    await page.goto('http://localhost:5174/')
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: /Sun \(no real asset\)/ }).click()
    await page.waitForTimeout(1200)
    await expect(page.locator('canvas')).toBeVisible()
    expect(assetRequests.some((u) => u.includes('sun.'))).toBe(false)
    expect(errors).toEqual([])
  })

  test('switching to "built-in placeholder shapes only" mode makes no asset requests at all', async ({ page }) => {
    await page.goto('http://localhost:5174/')
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Built-in placeholder shapes only' }).click()
    await page.waitForTimeout(500)

    const assetRequests: string[] = []
    page.on('response', (r) => {
      if (r.url().includes('/models/') || r.url().includes('/textures/')) assetRequests.push(r.url())
    })
    for (const label of ['Saturn', 'ISS', 'Earth']) {
      await page.getByRole('button', { name: label, exact: true }).click()
      await page.waitForTimeout(1000)
    }
    expect(assetRequests).toEqual([])
  })

  test('a failed texture load falls back to the placeholder instead of crashing the scene', async ({ page }) => {
    // Force the real texture request to fail (a genuine 404), exactly like
    // a broken/moved asset URL in production — without touching the
    // example's own real dataset. This is the actual regression this test
    // guards: ModelErrorBoundary catching a useTexture Suspense rejection,
    // the same way it already caught a useGLTF one before textureUrl
    // support was added.
    //
    // Not asserting on console/page errors here: three.js's loader (and
    // Vite's dev-mode overlay hook) both legitimately report the failed
    // fetch even though React's ErrorBoundary correctly recovers from it —
    // that noise is expected for a genuine 404, not a sign anything's
    // broken. The real assertions are behavioral: the scene stays alive
    // and the selection still goes through.
    await page.route('**/textures/mars.jpg', (route) => route.fulfill({ status: 404, body: 'not found' }))
    await page.goto('http://localhost:5174/')
    await page.waitForTimeout(500)
    await page.locator('select').selectOption({ label: 'Mars' })
    await page.waitForTimeout(1500)

    await expect(page.getByText('Selected: Mars')).toBeVisible()
    await expect(page.locator('canvas')).toBeVisible()
  })

  test('a failed model load falls back to the placeholder instead of crashing the scene', async ({ page }) => {
    // See the previous test for why this doesn't assert on console/page
    // errors — same reasoning, this time for useGLTF instead of useTexture.
    await page.route('**/models/iss.glb', (route) => route.fulfill({ status: 404, body: 'not found' }))
    await page.goto('http://localhost:5174/')
    await page.waitForTimeout(500)
    await page.locator('select').selectOption({ label: 'ISS' })
    await page.waitForTimeout(1500)

    await expect(page.getByText('Selected: ISS')).toBeVisible()
    await expect(page.locator('canvas')).toBeVisible()
  })
})
