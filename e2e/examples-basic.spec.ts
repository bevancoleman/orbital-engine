import { test, expect, type Page } from '@playwright/test'

// Regression coverage for the engine's built-in (placeholder-shape)
// rendering path — examples/basic never sets `modelUrl` on any body, so
// everything here renders through PlaceholderBodyShape, not a loaded glTF
// model. This is the path every consumer hits by default; a real 3D model
// is opt-in per body (see examples/with-models for that path instead).

function consoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  return errors
}

test.describe('examples/basic — built-in placeholder rendering', () => {
  test('loads the real Solar System with no console errors and a filled canvas', async ({ page }) => {
    const errors = consoleErrors(page)
    await page.goto('http://localhost:5173/')
    await page.waitForTimeout(1000)

    const canvas = page.locator('canvas')
    await expect(canvas).toBeVisible()
    const box = await canvas.boundingBox()
    expect(box?.width).toBeGreaterThan(100)
    expect(box?.height).toBeGreaterThan(100)
    expect(errors).toEqual([])
  })

  test('selecting a body via the dropdown shows real orbital data in the info panel', async ({ page }) => {
    await page.goto('http://localhost:5173/')
    await page.waitForTimeout(800)
    await page.locator('select').selectOption({ label: 'Earth' })
    await page.waitForTimeout(500)

    // The info panel shows real Kepler elements for an orbiting body —
    // semi-major axis (AU), eccentricity, inclination, period. These are
    // unambiguous (unlike the body's bare name, which also matches the
    // dropdown option and the fly-to button).
    await expect(page.getByText(/^a: /)).toBeVisible()
    await expect(page.getByText(/^e: /)).toBeVisible()
    await expect(page.getByText(/^period: /)).toBeVisible()
  })

  test('flying to the ISS does not crash and shows the pixel-floor note', async ({ page }) => {
    const errors = consoleErrors(page)
    await page.goto('http://localhost:5173/')
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: /ISS/ }).click()
    await page.waitForTimeout(1500)

    // ISS's radiusKm is tiny enough that, without the pixel-floor system,
    // this body would render sub-pixel/invisible — the note field on this
    // body exists specifically to flag that it's a representative
    // snapshot, not a stable mean element. Its presence is a reasonable
    // proxy that the real (non-placeholder-data) ISS entry rendered and
    // was selectable at all.
    await expect(page.locator('text=/snapshot/i')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('switching to the fictional fixed-position system re-renders without error', async ({ page }) => {
    const errors = consoleErrors(page)
    await page.goto('http://localhost:5173/')
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: /Fictional system/ }).click()
    await page.waitForTimeout(1000)

    await expect(page.getByRole('button', { name: 'Aurum', exact: true })).toBeVisible()
    // The dropdown is a genuine selection (unlike the "Fly to" buttons,
    // which only move the camera — see focusOnBody vs selectBody in
    // OrbitalSystemScene — so it's the one that actually notifies onSelectBody
    // and updates this page's own "Selected: …" text).
    await page.locator('select').selectOption({ label: 'Aurum' })
    await page.waitForTimeout(1000)
    await expect(page.getByText('Selected: Aurum')).toBeVisible()
    // A fixedPosition body has no orbital elements — the info panel must
    // not show Kepler-element fields for it.
    await expect(page.getByText(/^a: /)).not.toBeVisible()
    expect(errors).toEqual([])
  })

  test('Up/Down/Recenter/Reset controls do not throw', async ({ page }) => {
    const errors = consoleErrors(page)
    await page.goto('http://localhost:5173/')
    await page.waitForTimeout(800)
    await page.locator('select').selectOption({ label: 'Earth' })
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: '↓ Down' }).click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: '⟲ Recenter' }).click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: '↑ Up' }).click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Reset' }).click()
    await page.waitForTimeout(300)
    expect(errors).toEqual([])
  })
})
