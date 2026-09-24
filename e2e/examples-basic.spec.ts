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

  /** The zoom slider's own numeric value (see OrbitalSystemScene's `input[
   *  title^="Zoom"]`) — a direct, reliably-readable proxy for the live
   *  camera-to-target distance (CameraRig's `onDistanceChange`), without
   *  the timing imprecision of screenshot-based sampling. Distance is a
   *  monotonic (log-mapped) function of this value, so "does the value
   *  change gradually" and "does the value ever change at all" are both
   *  answerable straight from this, no pixel inspection needed. */
  async function zoomSliderValue(page: Page): Promise<number> {
    const value = await page.locator('input[type=range][title^="Zoom"]').inputValue()
    return Number(value)
  }

  test('camera tracks a fast-orbiting selected body through the zoom-in and afterward, without needing Recenter', async ({ page }) => {
    // Regression test for two related, real, reported bugs, both about
    // flying to a body while simulated time is playing:
    //
    // (a) selecting a body and zooming in from the whole-system view used
    // to leave the camera pointed at a stale snapshot of where the body
    // was when the fly-to STARTED, not where it ended up — for a fast
    // orbiter (the ISS completes a real orbit in ~92 minutes; at typical
    // playback speeds that's a large fraction of a full lap within the
    // ~900ms flight itself), the body would already be gone by the time
    // the camera finished arriving, and the user had to click Recenter
    // manually to reacquire it. Checked by directly sampling the WebGL
    // canvas — a console-error check would never catch this, since
    // nothing throws when the camera is just pointed at empty space.
    //
    // (b) "when time is on it is causing a lot of jumping... zooming to
    // ISS from the initial position when time is moving" — traced to a
    // DIFFERENT cause: re-aiming the flight at the ISS's LIVE position
    // every frame (the design at the time) sampled an essentially
    // arbitrary point on that tiny, fast circle each frame, so the
    // flight's own end kept leaping somewhere new every frame — visible as
    // the reported DISTANCE (not just position) failing to settle cleanly.
    //
    // Both were fixed the same way: OrbitalSystemScene computes the fresh
    // focus using a simDate already advanced by the flight's own duration
    // (see camera.ts's FLY_DURATION_MS/computeFocusForBody), so the flight
    // target is fixed — computed once, deterministically — for its whole
    // duration. The precise numeric claim (computeFocusForBody actually
    // resolves a predicted future simDate correctly, and the flight
    // endpoint stays fixed regardless of the tracked body's later live
    // position) is now covered exactly and deterministically by
    // camera.test.ts's "resolving a PREDICTED (non-"now") simDate" tests
    // and cameraFlightLifecycle.test.ts's "fixes the endpoint at flight
    // start" test. What only a real e2e run can still add: the actual
    // rendered canvas has real content (not empty space) once the flight
    // lands and stays tracked afterward, AND the reported distance
    // actually reaches and settles at the true-scale ISS distance instead
    // of wobbling.
    const errors = consoleErrors(page)
    await page.goto('http://localhost:5173/')
    // Long enough that the initial "frame the whole system" flight has
    // fully settled before this test's own flight starts — otherwise the
    // two overlap and this test would be exercising an unrelated,
    // legitimate "a fresh selection interrupts an in-progress flight"
    // case instead of the one it's named for.
    await page.waitForTimeout(1500)
    // Time starts paused by default now (see OrbitalSystemScene's
    // initialPlaying prop) — this test is specifically about tracking a
    // MOVING body, so it needs to explicitly start playback.
    await page.getByRole('button', { name: 'Play' }).click()

    await page.getByRole('button', { name: /ISS/ }).click()

    const samples: number[] = []
    for (let i = 0; i < 14; i++) {
      samples.push(await zoomSliderValue(page))
      await page.waitForTimeout(60)
    }
    // Distance itself monotonically shrinks (small tolerance for sampling
    // noise around equal integer slider values) — a genuine regression
    // (e.g. re-deriving the end distance from a moving target each frame)
    // tends to wobble the DISTANCE too, not just position. And it must
    // have actually gone somewhere, not stalled at the start.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeLessThanOrEqual(samples[i - 1]! + 2)
    }
    expect(samples[samples.length - 1]!).toBeLessThan(samples[0]! - 10)

    // And the canvas must show real content both right as the ~900ms
    // fly-to completes (exactly the moment bug (a) put the camera looking
    // at empty space) and afterward, as the ISS keeps moving — not just
    // win the single frame right as the flight ends.
    expect(await canvasHasContentAt(page)).toBe(true)
    await page.waitForTimeout(2000)
    expect(await canvasHasContentAt(page)).toBe(true)

    expect(errors).toEqual([])
  })

  test('switching repeatedly between the ISS and Hubble never throws or destabilizes the camera', async ({ page }) => {
    // Regression coverage for a real, reported bug: "switching between ISS
    // and Hubble, it seems about 50:50 if it will animate or just jump to
    // the other object" — with playback paused, ruling out the moving-
    // target case entirely. Two real causes were found and fixed (see
    // CameraRig.tsx's own header comment, bugs four and five):
    // camera-controls' own transition system silently snapping instead of
    // animating whenever a component's delta fell below its fixed 1e-5
    // world-unit epsilon (routine for two true-scale satellites both only
    // a few hundred km from Earth), and a genuine race between a
    // `useEffect`-driven flight start and R3F's own frame loop.
    //
    // Both the exact numeric claim (sampleFlightPath still produces real,
    // distinct intermediate points at THIS pair's own tiny (~1e-6 world
    // unit) scale rather than collapsing to a snap — camera.test.ts's own
    // "still animates smoothly across a true-scale-tiny distance" test)
    // AND the collider-exclusion sequencing behind the race itself
    // (cameraFlightLifecycle.test.ts's "excludes both the outgoing and
    // incoming body" test) are now covered precisely and deterministically
    // by fast unit tests — this no longer needs many repeated iterations
    // to have a reasonable chance of catching a timing-dependent race; 2 is
    // enough to catch a REGRESSION in either while staying fast. What only
    // e2e coverage can still usefully add: repeated real selection churn
    // between two true-scale bodies never throws, and the canvas has real
    // content both mid-flight and once settled — the latter specifically
    // guards the shared-parent "establishing shot" fix (see camera.ts's
    // findContextBody/applyContextBulge) actually rendering correctly,
    // which no pure-function test can see (it doesn't render anything).
    const errors = consoleErrors(page)
    await page.goto('http://localhost:5173/')
    await page.waitForTimeout(800)

    // Already paused by default (see OrbitalSystemScene's initialPlaying
    // prop) — the report was specifically that this reproduces without
    // the camera also having to cope with the objects moving.

    await page.locator('select').selectOption({ label: 'ISS' })
    await page.waitForTimeout(1200)

    for (let i = 0; i < 2; i++) {
      const label = i % 2 === 0 ? 'Hubble Space Telescope' : 'ISS'
      await page.locator('select').selectOption({ label })
      // Mid-flight is now also asserted, not just settled: a separate,
      // real issue meant the straight-line path between two satellites of
      // the same nearby parent could put the camera behind/inside that
      // parent's own mesh partway through, blanking the canvas to empty
      // deep space for a frame or two (Earth failing backface culling
      // from the inside) — verified (directly, via screenshot) to show up
      // specifically around 100ms into the ~900ms flight for this pair,
      // NOT at the midpoint; sampling at 450ms alone passed even with the
      // bug reintroduced, since that's past where it actually occurs.
      // Fixed by camera.ts's applyContextBulge/findContextBody — Earth
      // (their shared parent) now stays framed as an establishing-shot
      // anchor for a good stretch of the flight, not just its exact
      // midpoint, so there should be real content on screen throughout.
      await page.waitForTimeout(100)
      expect(await canvasHasContentAt(page)).toBe(true)
      await page.waitForTimeout(350) // roughly the flight's own midpoint
      expect(await canvasHasContentAt(page)).toBe(true)
      await page.waitForTimeout(850) // let it fully settle
      expect(await canvasHasContentAt(page)).toBe(true)
    }

    expect(errors).toEqual([])
  })

  test('tracking the Moon while time plays quickly does not flicker the camera between two distances', async ({
    page,
  }) => {
    // Regression test for a real, reported bug: watching a selected body
    // with the simulation running quickly (2 d/s at the time this was
    // reported — this scene's default speed has since changed, see
    // timeScale.ts, so this drives the slider explicitly rather than
    // relying on whatever the current default happens to be) showed the
    // Moon "appearing twice... switching location alternating between
    // frames" — traced to CameraRig reading camera-controls' TRANSITION-
    // END camera state (the default) instead of its LIVE one while
    // rigidly translating the tracked camera/target each frame, which
    // silently undid camera-controls' own per-frame collision clamp,
    // immediately reapplied next frame, forever — see CameraRig.tsx's own
    // header comment. A steady, uncontested track (no manual zoom, no
    // flight) should report a STABLE distance from one sample to the
    // next; a clamp-fight shows up as the reported distance swinging by a
    // large amount between consecutive samples, not settling.
    const errors = consoleErrors(page)
    await page.goto('http://localhost:5173/')
    await page.waitForTimeout(800)

    await page.locator('select').selectOption({ label: 'Moon' })
    await page.waitForTimeout(1500) // let the fly-to settle

    // Time starts paused by default now (see OrbitalSystemScene's
    // initialPlaying prop) — this test needs it playing throughout, and
    // pushed up fast: the higher the speed, the bigger the per-frame
    // tracking delta, and the more this bug (when present) shows up.
    const speedSlider = page.getByLabel('Speed')
    await speedSlider.evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(el, '1000') // max — a simulated year every 60 real seconds
      el.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    await page.getByRole('button', { name: 'Play' }).click()

    const samples: number[] = []
    for (let i = 0; i < 20; i++) {
      samples.push(await zoomSliderValue(page))
      await page.waitForTimeout(60)
    }

    expect(await canvasHasContentAt(page)).toBe(true)

    // A clamp-fight alternates between two distant values every frame —
    // total movement many times larger than the actual range visited.
    // Smooth (or even legitimately-clamped-and-released) tracking stays
    // within a modest multiple of its own range; this bounds that ratio
    // generously rather than demanding an exactly flat line, since a real
    // obstruction passing briefly through the view is correct behaviour,
    // not a bug — only RAPID, REPEATED back-and-forth is.
    const range = Math.max(...samples) - Math.min(...samples)
    const totalVariation = samples.slice(1).reduce((sum, v, i) => sum + Math.abs(v - samples[i]!), 0)
    expect(totalVariation).toBeLessThan(Math.max(range, 1) * 6)

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

  /** The action log textarea's current text (see App.tsx's `aria-label="Action
   *  log"` textarea, fed by OrbitalSystemScene's onAction prop) — read the
   *  same way the existing tests read the Speed slider's value. */
  async function actionLogText(page: Page): Promise<string> {
    return page.getByLabel('Action log').inputValue()
  }

  test('recordable UI actions (select, pause/play, speed) show up in the action log in order', async ({ page }) => {
    // Coverage for the new onAction/actionLog feature (see src/actionLog.ts):
    // this session's own camera bugs took a lot of screenshot debugging to
    // pin down partly because a bug report never said exactly what was
    // clicked, when, or what the simulated date was at the time — this test
    // just verifies the plumbing actually reaches the example app's log
    // textarea and preserves the order actions happened in, not the exact
    // timing/format details (those are covered precisely and deterministically
    // by actionLog.test.ts).
    const errors = consoleErrors(page)
    await page.goto('http://localhost:5173/')
    await page.waitForTimeout(800)

    // A session-start entry should already be there from mount, before any
    // user interaction at all.
    expect(await actionLogText(page)).toContain('session-start')

    await page.locator('select').selectOption({ label: 'Earth' })
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Play' }).click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Pause' }).click()
    await page.waitForTimeout(300)

    const speedSlider = page.getByLabel('Speed')
    await speedSlider.evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(el, '700')
      el.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    // Poll rather than a single fixed wait past the 300ms debounce — under
    // real browser/CI scheduling load the debounce firing can land a bit
    // later than the nominal 300ms, and a flaky fixed wait here would be
    // indistinguishable from an actual regression.
    await expect(async () => {
      expect(await actionLogText(page)).toContain('set-speed')
    }).toPass({ timeout: 3000 })

    const text = await actionLogText(page)
    const selectBodyAt = text.indexOf('select-body')
    const playAt = text.indexOf(' play ')
    const pauseAt = text.indexOf('pause')
    const setSpeedAt = text.indexOf('set-speed')

    expect(selectBodyAt).toBeGreaterThan(-1)
    expect(playAt).toBeGreaterThan(-1)
    expect(pauseAt).toBeGreaterThan(-1)
    expect(setSpeedAt).toBeGreaterThan(-1)
    expect(selectBodyAt).toBeLessThan(playAt)
    expect(playAt).toBeLessThan(pauseAt)
    expect(pauseAt).toBeLessThan(setSpeedAt)

    expect(errors).toEqual([])
  })

  test('rapidly changing the speed slider debounces into a small number of set-speed log entries', async ({ page }) => {
    // Coverage for the debounce specifically: dragging a slider fires its
    // underlying DOM 'input' event continuously (potentially once per
    // pixel), and logging every tick would flood a reproduction log with
    // noise instead of the one value the user actually settled on. This
    // drives many rapid raw changes and asserts the log ends up with far
    // fewer set-speed entries than changes made, not one per change.
    await page.goto('http://localhost:5173/')
    await page.waitForTimeout(800)

    const speedSlider = page.getByLabel('Speed')
    const rawChangeCount = 15
    // Dispatched from inside one page.evaluate() rather than rawChangeCount
    // separate Playwright round-trips: each round-trip's own IPC overhead is
    // unpredictable under load (confirmed: this reproduced reliably in CI —
    // 14 of 15 changes each getting their own log entry, i.e. no debouncing
    // at all — while passing locally every time), and 15 round-trips each
    // needing to land within the fixed 300ms debounce window is exactly the
    // shape of test that overhead breaks. A single synchronous in-page loop
    // has no such per-step overhead, making the real gap between events the
    // ~few ms the setTimeout calls below actually take, not whatever the
    // test runner's IPC happened to cost that run.
    await speedSlider.evaluate((el, count) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      for (let i = 0; i < count; i++) {
        setter.call(el, String(100 + i * 50))
        el.dispatchEvent(new window.Event('input', { bubbles: true }))
      }
    }, rawChangeCount)
    // Let the debounce settle once dragging stops — poll rather than a
    // single fixed wait, same reasoning as the ordering test above.
    await expect(async () => {
      expect(await actionLogText(page)).toContain('set-speed')
    }).toPass({ timeout: 3000 })

    const text = await actionLogText(page)
    const setSpeedCount = (text.match(/set-speed/g) ?? []).length
    expect(setSpeedCount).toBeGreaterThan(0)
    expect(setSpeedCount).toBeLessThan(rawChangeCount / 3)
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
