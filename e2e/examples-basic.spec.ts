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

/** Reports whether a region of the rendered page — centered at the given
 *  normalized (cx, cy) in [0, 1] within the canvas, `sizeFraction` of its
 *  smaller dimension square — has any real content in it, as opposed to
 *  being pure/near-pure empty space. This is the real, direct way to check
 *  "is the selected body actually on screen, not just did nothing throw"
 *  — the scene's background is always solid black (see the Canvas's own
 *  `<color attach="background">`), so a region with nothing in it screens
 *  as uniformly black. Used to catch the exact regression this guards: the
 *  camera finishing a fly-to/zoom pointed at empty space instead of the
 *  tracked body, which no console-error check would ever catch (nothing
 *  throws — the camera is just aimed wrong).
 *
 *  Implemented via PNG byte size, not manual pixel inspection — an earlier
 *  version drew the canvas onto an offscreen 2D canvas and read pixels
 *  back via an in-page `page.evaluate()`, which isn't synchronized with
 *  the browser's actual paint/composite cycle the way `page.screenshot()`
 *  is; it intermittently read a stale/blank buffer even while the body was
 *  demonstrably visible in a real screenshot taken the same moment. A
 *  uniform black region compresses to a tiny PNG (a few hundred bytes);
 *  anything with real content — a body, its label text, starfield detail —
 *  is at least an order of magnitude larger. `page.screenshot()` goes
 *  through Playwright's own capture path, so it reflects what was actually
 *  composited, not an ad-hoc in-page redraw.
 *
 *  `sizeFraction` defaults to a generous "somewhere reasonably central"
 *  region, not a pixel-exact center point — camera framing settles a
 *  selected body close to center, not dead-on-the-pixel. */
async function canvasHasContentAt(page: Page, cx = 0.5, cy = 0.5, sizeFraction = 0.3): Promise<boolean> {
  const box = await page.locator('canvas').boundingBox()
  if (!box) return false
  const size = Math.max(20, Math.min(box.width, box.height) * sizeFraction)
  const clip = {
    x: Math.min(Math.max(box.x, box.x + box.width * cx - size / 2), box.x + box.width - size),
    y: Math.min(Math.max(box.y, box.y + box.height * cy - size / 2), box.y + box.height - size),
    width: size,
    height: size,
  }
  const buf = await page.screenshot({ clip })
  // Empirically: a genuinely empty (near-black starfield) region compresses
  // to ~150-200 bytes; real content (a body, label text) is 10x-100x that.
  return buf.length > 500
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

  test('secondary bodies in a sparse system are visible at a normal system-framing zoom', async ({ page }) => {
    // Regression test for a real, reported bug: the old visibility gate was
    // a single hard distance-ratio cliff, applied identically regardless of
    // how many bodies a system actually has — a body could vanish entirely
    // on what looked like a trivial zoom change, even in a 4-body system
    // with plenty of empty screen space around it (see visibility.ts's own
    // comment on computeVisibleBodyIds/isAlwaysVisible for the full
    // history). This fictional system has exactly the shape that exposed
    // it: "Aurum High Station" and "Outbound Gateway" are both secondary
    // (non-primary) bodies, well under any reasonable per-system cap, so
    // both should be visible together at a normal, whole-system-ish zoom —
    // not just the primary star.
    //
    // Deliberately checked at ONE verified zoom level, not swept across a
    // range: label TEXT visibility (as opposed to the body's own dot,
    // which isn't independently DOM-queryable) is also subject to
    // ordinary screen-space label decluttering (see labelDeclutter.ts),
    // which legitimately hides a label when two land close together on
    // screen at some other zoom level — a real, separate, working feature,
    // not the bug this test guards against.
    const errors = consoleErrors(page)
    await page.goto('http://localhost:5173/')
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: /Fictional system/ }).click()
    await page.waitForTimeout(1000)

    const slider = page.locator('input[type=range]').first()
    await slider.evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(el, '700')
      el.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    await page.waitForTimeout(700)

    // The toolbar's own "Fly to" buttons share the same text as the
    // in-canvas labels this test actually cares about — scope to <div>
    // (the label) rather than <button> (the toolbar) to avoid ambiguity.
    await expect(page.getByText('Aurum High Station', { exact: true }).and(page.locator('div'))).toBeVisible()
    await expect(page.getByText('Outbound Gateway', { exact: true }).and(page.locator('div'))).toBeVisible()
    expect(errors).toEqual([])
  })

  test('camera tracks a fast-orbiting selected body through the zoom-in and afterward, without needing Recenter', async ({ page }) => {
    // Regression test for a real, reported bug: selecting a body and
    // zooming in from the whole-system view used to leave the camera
    // pointed at a stale snapshot of where the body was when the fly-to
    // STARTED, not where it ended up — for a fast orbiter (the ISS
    // completes a real orbit in ~92 minutes; at this scene's default
    // playback speed that's a large fraction of a full lap within the
    // ~900ms flight itself), the body would already be gone by the time
    // the camera finished arriving, and the user had to click Recenter
    // manually to reacquire it. Checked by directly sampling the WebGL
    // canvas — a console-error check would never catch this, since
    // nothing throws when the camera is just pointed at empty space.
    const errors = consoleErrors(page)
    await page.goto('http://localhost:5173/')
    await page.waitForTimeout(800)

    await page.getByRole('button', { name: /ISS/ }).click()
    // Sample right as the ~900ms fly-to animation completes — this is
    // exactly the moment the bug put the camera looking at empty space.
    await page.waitForTimeout(950)
    expect(await canvasHasContentAt(page)).toBe(true)

    // And it must STAY tracked afterward too, as the ISS keeps moving —
    // not just win the single frame right as the flight ends.
    await page.waitForTimeout(2000)
    expect(await canvasHasContentAt(page)).toBe(true)
    await page.waitForTimeout(2000)
    expect(await canvasHasContentAt(page)).toBe(true)

    expect(errors).toEqual([])
  })

  test('sanity check: canvasHasContentAt can actually detect empty space', async ({ page }) => {
    // Proves the helper above isn't just trivially always-true. The exact
    // center of frame isn't safe to assume is empty (the default view is
    // already framed on the star, which sits right there) — a screen
    // CORNER is: no reasonable camera framing (whole-system or zoomed to
    // any one body) puts a foreground object in the extreme corner of the
    // viewport, so it's reliably deep space regardless of what's selected.
    await page.goto('http://localhost:5173/')
    await page.waitForTimeout(1000)
    // A small region here, deliberately — the default 0.3 "generous,
    // roughly central" size would extend well past the corner into real
    // content at this zoom level, which isn't what this check is testing.
    expect(await canvasHasContentAt(page, 0.02, 0.02, 0.03)).toBe(false)
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
