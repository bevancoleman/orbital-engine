import { test, expect, type Page } from '@playwright/test'

import { EMPTY_SPACE_MAX_LIT, litFractionAt } from './support/frameSampler'
import { flyAndSettle, gotoScene, sceneRoot, trackErrors } from './support/scene'

// Regression coverage for CelestialBody.modelUrl (real 3D models) and
// CelestialBody.textureUrl (real surface textures on the built-in sphere) —
// both opt-in per body, both must fall back cleanly to the placeholder
// shape if unset or if loading fails, and neither should ever crash the
// whole scene for one bad body. Waits are on the scene's observable state
// (see support/scene.ts) and on the network itself, never fixed sleeps.

const URL = 'http://localhost:5174/'

function isAssetUrl(url: string): boolean {
  return url.includes('/models/') || url.includes('/textures/')
}

/** Every successful asset response from now on. */
function trackAssetResponses(page: Page): string[] {
  const urls: string[] = []
  page.on('response', (r) => {
    if (r.ok() && isAssetUrl(r.url())) urls.push(r.url())
  })
  return urls
}

/** Every asset REQUEST from now on, whatever its outcome. */
function trackAssetRequests(page: Page): string[] {
  const urls: string[] = []
  page.on('request', (r) => {
    if (isAssetUrl(r.url())) urls.push(r.url())
  })
  return urls
}

/** Makes `path` fail with a genuine 404 and records the status of every
 *  response for it — from before navigation, since the load can start as
 *  soon as the body first renders, not only once it's selected. */
async function trackFailedAsset(page: Page, path: string): Promise<number[]> {
  const statuses: number[] = []
  await page.route(`**${path}`, (route) => route.fulfill({ status: 404, body: 'not found' }))
  page.on('response', (r) => {
    if (r.url().includes(path)) statuses.push(r.status())
  })
  return statuses
}

/** Fly-to buttons for bodies with a real asset get a trailing " ✓" (see
 *  App.tsx) — match by regex rather than the bare label. */
function flyTo(page: Page, label: string): Promise<void> {
  return flyAndSettle(page, () => page.getByRole('button', { name: new RegExp(`^${label}\\b`) }).click())
}

test.describe('examples/with-models — real assets', () => {
  test('loads with no console errors, real-assets mode selected by default', async ({ page }) => {
    const errors = trackErrors(page)
    await gotoScene(page, URL)
    await expect(page.locator('canvas')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Real NASA models/textures where available' })).toBeDisabled()
    expect(errors).toEqual([])
  })

  test('flying to bodies with a real model or texture actually fetches it (200, not a silent fallback)', async ({ page }) => {
    const assetResponses = trackAssetResponses(page)
    await gotoScene(page, URL)
    for (const [label, asset] of [
      ['Saturn', 'saturn.jpg'],
      ['ISS', 'iss.glb'],
      ['Hubble', 'hubble.glb'],
      ['Earth', 'earth.jpg'],
    ] as const) {
      await flyTo(page, label)
      // Polled: the load starts once the body renders close up, which can
      // trail the flight landing by a frame or two.
      await expect.poll(() => assetResponses.some((u) => u.includes(asset)), { message: asset }).toBe(true)
    }
  })

  test('a body with no real asset (Sun) still renders via the placeholder — no request, no error', async ({ page }) => {
    const errors = trackErrors(page)
    const assetRequests = trackAssetRequests(page)
    await gotoScene(page, URL)
    await flyTo(page, 'Sun')
    await expect(sceneRoot(page)).toHaveAttribute('data-focused-id', 'sun')
    expect(await litFractionAt(page)).toBeGreaterThan(EMPTY_SPACE_MAX_LIT)
    expect(assetRequests.some((u) => u.includes('sun.'))).toBe(false)
    expect(errors).toEqual([])
  })

  test('"built-in placeholder shapes only" mode makes no asset requests at all', async ({ page }) => {
    // A fresh page that STARTS in placeholder mode (?mode=placeholders, see
    // App.tsx), with the listener attached before navigation. The old
    // version loaded real-assets mode first and attached its listener only
    // after switching, so anything already fetched — and cached by drei's
    // loader cache — couldn't show up as a request either way: the test
    // could pass even if placeholder mode did reference the assets.
    const assetRequests = trackAssetRequests(page)
    await gotoScene(page, `${URL}?mode=placeholders`)
    await expect(page.getByRole('button', { name: 'Built-in placeholder shapes only' })).toBeDisabled()
    for (const label of ['Saturn', 'ISS', 'Earth']) await flyTo(page, label)
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
    // broken. The real assertions are behavioral: the 404 was actually
    // served, the selection still goes through, and the scene keeps
    // rendering the body (the placeholder) where the texture would be.
    const failedStatuses = await trackFailedAsset(page, '/textures/mars.jpg')
    await gotoScene(page, URL)
    await flyAndSettle(page, async () => {
      await page.locator('select').selectOption({ label: 'Mars' })
    })
    await expect.poll(() => failedStatuses).toContain(404)

    await expect(page.getByText('Selected: Mars')).toBeVisible()
    await expect(sceneRoot(page)).toHaveAttribute('data-camera-state', 'tracking')
    expect(await litFractionAt(page)).toBeGreaterThan(EMPTY_SPACE_MAX_LIT)
  })

  test('a failed model load falls back to the placeholder instead of crashing the scene', async ({ page }) => {
    // See the previous test for why this doesn't assert on console/page
    // errors — same reasoning, this time for useGLTF instead of useTexture.
    const failedStatuses = await trackFailedAsset(page, '/models/iss.glb')
    await gotoScene(page, URL)
    await flyAndSettle(page, async () => {
      await page.locator('select').selectOption({ label: 'ISS' })
    })
    await expect.poll(() => failedStatuses).toContain(404)

    await expect(page.getByText('Selected: ISS')).toBeVisible()
    await expect(sceneRoot(page)).toHaveAttribute('data-camera-state', 'tracking')
    expect(await litFractionAt(page)).toBeGreaterThan(EMPTY_SPACE_MAX_LIT)
  })
})
