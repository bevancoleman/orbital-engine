import { test, expect, type Page } from '@playwright/test'

import {
  CENTRE,
  EMPTY_SPACE_MAX_LIT,
  bodyStaysCentred,
  describeSamples,
  litFractionAt,
  sampleFlight,
  sampleFor,
} from './support/frameSampler'
import {
  flightCount,
  flyAndSettle,
  gotoScene,
  play,
  sceneRoot,
  setMaxSpeed,
  setRangeValue,
  trackErrors,
  waitForCameraAtRest,
} from './support/scene'

// Regression coverage for the engine's built-in (placeholder-shape)
// rendering path — examples/basic never sets `modelUrl` on any body, so
// everything here renders through PlaceholderBodyShape, not a loaded glTF
// model. This is the path every consumer hits by default; a real 3D model
// is opt-in per body (see examples/with-models for that path instead).
//
// No fixed sleeps: every wait is on the scene's observable state (its
// root's data-camera-state / data-flight-count / data-focused-id /
// data-sim-playing attributes — see support/scene.ts) or an auto-retrying
// assertion, and every "what's on screen" check reads real rendered frames
// (see support/frameSampler.ts) — never a screenshot taken at a guessed
// moment of the flight.

const URL = 'http://localhost:5173/'

function select(page: Page, label: string): Promise<string[]> {
  return page.locator('select').selectOption({ label })
}

/** The example keys OrbitalSystemScene by system id, so switching mounts a
 *  fresh scene (flight count back to 0) whose own initial framing flight
 *  is the one to wait for. The click's React update is a discrete event,
 *  committed before click() resolves, so the old scene's state can't be
 *  mistaken for the new one's. */
async function switchToFictionalSystem(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Fictional system/ }).click()
  await expect(page.getByRole('button', { name: 'Aurum', exact: true })).toBeVisible()
  await waitForCameraAtRest(page, 1)
}

test.describe('examples/basic — built-in placeholder rendering', () => {
  test('loads the real Solar System with no console errors and a filled canvas', async ({ page }) => {
    const errors = trackErrors(page)
    await gotoScene(page, URL)

    const canvas = page.locator('canvas')
    await expect(canvas).toBeVisible()
    const box = await canvas.boundingBox()
    expect(box?.width).toBeGreaterThan(100)
    expect(box?.height).toBeGreaterThan(100)
    expect(await litFractionAt(page)).toBeGreaterThan(EMPTY_SPACE_MAX_LIT)
    expect(errors).toEqual([])
  })

  test('selecting a body via the dropdown shows real orbital data in the info panel', async ({ page }) => {
    await gotoScene(page, URL)
    await select(page, 'Earth')
    await expect(sceneRoot(page)).toHaveAttribute('data-focused-id', 'earth')

    // The info panel shows real Kepler elements for an orbiting body —
    // semi-major axis (AU), eccentricity, inclination, period. These are
    // unambiguous (unlike the body's bare name, which also matches the
    // dropdown option and the fly-to button).
    await expect(page.getByText(/^a: /)).toBeVisible()
    await expect(page.getByText(/^e: /)).toBeVisible()
    await expect(page.getByText(/^period: /)).toBeVisible()
  })

  test('flying to the ISS does not crash and shows the pixel-floor note', async ({ page }) => {
    const errors = trackErrors(page)
    await gotoScene(page, URL)
    await flyAndSettle(page, () => page.getByRole('button', { name: /ISS/ }).click())

    // ISS's radiusKm is tiny enough that, without the pixel-floor system,
    // this body would render sub-pixel/invisible — the note field on this
    // body exists specifically to flag that it's a representative
    // snapshot, not a stable mean element. Its presence is a reasonable
    // proxy that the real (non-placeholder-data) ISS entry rendered and
    // was selectable at all.
    await expect(sceneRoot(page)).toHaveAttribute('data-focused-id', 'iss')
    await expect(page.locator('text=/snapshot/i')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('switching to the fictional fixed-position system re-renders without error', async ({ page }) => {
    const errors = trackErrors(page)
    await gotoScene(page, URL)
    await switchToFictionalSystem(page)

    // The dropdown is a genuine selection (unlike the "Fly to" buttons,
    // which only move the camera — see focusOnBody vs selectBody in
    // useSelectionNavigation — so it's the one that actually notifies
    // onSelectBody and updates this page's own "Selected: …" text).
    await flyAndSettle(page, async () => {
      await select(page, 'Aurum')
    })
    await expect(page.getByText('Selected: Aurum')).toBeVisible()
    // A fixed-position body is still "tracked" (its position just never
    // changes) — the camera locks on it the same way.
    await expect(sceneRoot(page)).toHaveAttribute('data-camera-state', 'tracking')
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
    const errors = trackErrors(page)
    await gotoScene(page, URL)
    await switchToFictionalSystem(page)

    // The zoom slider applies immediately (no flight); the label
    // assertions below auto-retry until the visibility pass has caught up.
    await setRangeValue(page.locator('input[type=range]').first(), 700)

    // The toolbar's own "Fly to" buttons share the same text as the
    // in-canvas labels this test actually cares about — scope to <div>
    // (the label) rather than <button> (the toolbar) to avoid ambiguity.
    await expect(page.getByText('Aurum High Station', { exact: true }).and(page.locator('div'))).toBeVisible()
    await expect(page.getByText('Outbound Gateway', { exact: true }).and(page.locator('div'))).toBeVisible()
    expect(errors).toEqual([])
  })

  test('camera tracks a fast-orbiting selected body through the zoom-in and afterward, without needing Recenter', async ({ page }) => {
    // Regression test for two related, real, reported bugs, both about
    // flying to a body while simulated time is playing:
    //
    // (a) selecting a body and zooming in from the whole-system view used
    // to leave the camera pointed at a stale snapshot of where the body
    // was when the fly-to STARTED, not where it ended up — for a fast
    // orbiter (the ISS completes a real orbit in ~92 minutes; at typical
    // playback speeds that's a large fraction of a full lap within the
    // flight itself), the body would already be gone by the time
    // the camera finished arriving, and the user had to click Recenter
    // manually to reacquire it. Checked on every rendered frame from the
    // landing onward — the ISS's own label (projected from the body's
    // position by the same camera) must sit over the canvas centre, and
    // the centre must have real rendered content. A console-error check
    // would never catch this: nothing throws when the camera is just
    // pointed at empty space.
    //
    // (b) "when time is on it is causing a lot of jumping... zooming to
    // ISS from the initial position when time is moving" — traced to a
    // DIFFERENT cause: re-aiming the flight at the ISS's LIVE position
    // every frame (the design at the time) sampled an essentially
    // arbitrary point on that tiny, fast circle each frame, so the
    // flight's own end kept leaping somewhere new every frame — visible as
    // the reported DISTANCE (not just position) failing to settle cleanly.
    //
    // Both were fixed the same way: the flight target is computed once,
    // deterministically, from a simDate already advanced by the flight's
    // own planned duration (see camera.ts's planFocusFlight and
    // computeFocusForBody).
    // The precise numeric claims are covered by camera.test.ts's
    // "resolving a PREDICTED (non-"now") simDate" tests and
    // cameraFlightLifecycle.test.ts's "fixes the endpoint at flight start"
    // test. What only a real browser can add: the rendered frames
    // themselves, every one of them, through and after the landing.
    const errors = trackErrors(page)
    // gotoScene waits for the initial "frame the whole system" flight to
    // land — otherwise this test would be exercising the unrelated,
    // legitimate "a fresh selection interrupts an in-progress flight" case.
    await gotoScene(page, URL)
    // Time starts paused by default (see OrbitalSystemScene's
    // initialPlaying prop) — this test is about tracking a MOVING body.
    await play(page)

    const flight = await sampleFlight(page, () => page.getByRole('button', { name: /ISS/ }).click(), { bodyName: 'ISS' })
    const flying = flight.filter((s) => s.cameraState === 'flying')
    expect(flying.length, describeSamples(flight)).toBeGreaterThan(0)
    // Distance itself monotonically shrinks across every flight frame
    // (small tolerance for equal-ish slider values) — a genuine regression
    // (e.g. re-deriving the end distance from a moving target each frame)
    // tends to wobble the DISTANCE too, not just position. And it must
    // have actually gone somewhere, not stalled at the start.
    for (let i = 1; i < flying.length; i++) {
      expect(flying[i]!.zoom, describeSamples(flight)).toBeLessThanOrEqual(flying[i - 1]!.zoom + 2)
    }
    expect(flight[flight.length - 1]!.zoom).toBeLessThan(flight[0]!.zoom - 10)

    // The landing frame itself (exactly the moment bug (a) put the camera
    // on empty space) and two more seconds of the ISS moving afterward.
    const landed = [...flight.slice(-1), ...(await sampleFor(page, 2000, { bodyName: 'ISS' }))]
    const centred = bodyStaysCentred(landed)
    expect(centred.ok, centred.detail).toBe(true)
    for (const sample of landed) expect(sample.lit, describeSamples(landed)).toBeGreaterThan(EMPTY_SPACE_MAX_LIT)
    expect(errors).toEqual([])
  })

  test('the ISS stays centred for several seconds at maximum playback speed (no slow drift)', async ({ page }) => {
    // Coverage for review finding A1 (see cameraFlightLifecycle's
    // advanceSteadyTracking): steady tracking used to apply only the
    // frame-to-frame DELTA of the tracked position, so any gap between the
    // flight's predicted end target and the body's real position at the
    // settle frame was carried forward forever — at speed, the ISS crept
    // (or jumped) off-screen and never came back. Unit tests pin the
    // anchoring rule; this checks the real render loop over many frames at
    // the speed where a 1ms mismatch is hundreds of framing distances.
    const errors = trackErrors(page)
    await gotoScene(page, URL)
    await setMaxSpeed(page)
    await play(page)
    await flyAndSettle(page, () => page.getByRole('button', { name: /ISS/ }).click())

    const samples = await sampleFor(page, 3000, { bodyName: 'ISS' })
    expect(samples.length).toBeGreaterThan(5)
    const centred = bodyStaysCentred(samples)
    expect(centred.ok, centred.detail).toBe(true)
    for (const sample of samples) {
      expect(sample.cameraState).toBe('tracking')
      expect(sample.lit, describeSamples(samples)).toBeGreaterThan(EMPTY_SPACE_MAX_LIT)
    }
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
    // `useEffect`-driven flight start and R3F's own frame loop. Both are
    // covered precisely by unit tests (camera.test.ts's "still animates
    // smoothly across a true-scale-tiny distance", cameraFlightLifecycle
    // .test.ts's "excludes both the outgoing and incoming body"); 2
    // switches here are enough to catch a regression in the real loop.
    //
    // Mid-flight is asserted on EVERY flight frame: a separate, real issue
    // meant the straight-line path between two satellites of the same
    // nearby parent could put the camera behind/inside that parent's own
    // mesh partway through, blanking the canvas to empty deep space for a
    // frame or two (Earth failing backface culling from the inside) —
    // first seen around 100ms into the flight, NOT at the midpoint, which
    // is why the old fixed-time screenshots (at 100ms and 450ms) were both
    // fragile and incomplete. Fixed by camera.ts's applyContextBulge/
    // findContextBody — Earth (their shared parent) stays framed as an
    // establishing-shot anchor through the flight, so every frame has real
    // content. No pure-function test can see that rendered result.
    const errors = trackErrors(page)
    await gotoScene(page, URL)
    // Already paused by default (see OrbitalSystemScene's initialPlaying
    // prop) — the report was specifically that this reproduces without
    // the camera also having to cope with the objects moving.
    await flyAndSettle(page, async () => {
      await select(page, 'ISS')
    })

    for (const label of ['Hubble Space Telescope', 'ISS']) {
      const samples = await sampleFlight(page, async () => {
        await select(page, label)
      }, { bodyName: label })
      const flying = samples.filter((s) => s.cameraState === 'flying')
      expect(flying.length, describeSamples(samples)).toBeGreaterThan(0)
      for (const sample of samples) expect(sample.lit, describeSamples(samples)).toBeGreaterThan(EMPTY_SPACE_MAX_LIT)
      // And it lands centred on the new body (checked over a few more
      // frames, not just the landing one).
      const centred = bodyStaysCentred(await sampleFor(page, 300, { bodyName: label }))
      expect(centred.ok, centred.detail).toBe(true)
    }

    expect(errors).toEqual([])
  })

  test('tracking the Moon while time plays quickly does not flicker the camera between two distances', async ({
    page,
  }) => {
    // Regression test for a real, reported bug: watching a selected body
    // with the simulation running quickly showed the Moon "appearing
    // twice... switching location alternating between frames" — traced to
    // CameraRig reading camera-controls' TRANSITION-END camera state (the
    // default) instead of its LIVE one while rigidly translating the
    // tracked camera/target each frame, which silently undid camera-
    // controls' own per-frame collision clamp, immediately reapplied next
    // frame, forever — see CameraRig.tsx's own header comment. A steady,
    // uncontested track (no manual zoom, no flight) should report a STABLE
    // distance from one frame to the next; a clamp-fight shows up as the
    // reported distance swinging by a large amount between consecutive
    // frames. Sampled on every rendered frame rather than every ~60ms, so
    // a frame-to-frame alternation can't alias away.
    const errors = trackErrors(page)
    await gotoScene(page, URL)
    await flyAndSettle(page, async () => {
      await select(page, 'Moon')
    })

    // Driven explicitly to max rather than relying on the default speed
    // (see timeScale.ts): the higher the speed, the bigger the per-frame
    // tracking delta, and the more this bug (when present) shows up.
    await setMaxSpeed(page)
    await play(page)

    const samples = await sampleFor(page, 1500, { bodyName: 'Moon' })
    const centred = bodyStaysCentred(samples)
    expect(centred.ok, centred.detail).toBe(true)
    expect(samples[samples.length - 1]!.lit).toBeGreaterThan(EMPTY_SPACE_MAX_LIT)

    // A clamp-fight alternates between two distant values every frame —
    // total movement many times larger than the actual range visited.
    // Smooth (or even legitimately-clamped-and-released) tracking stays
    // within a modest multiple of its own range; this bounds that ratio
    // generously rather than demanding an exactly flat line, since a real
    // obstruction passing briefly through the view is correct behaviour,
    // not a bug — only RAPID, REPEATED back-and-forth is.
    const zooms = samples.map((s) => s.zoom)
    const range = Math.max(...zooms) - Math.min(...zooms)
    const totalVariation = zooms.slice(1).reduce((sum, v, i) => sum + Math.abs(v - zooms[i]!), 0)
    expect(totalVariation, describeSamples(samples)).toBeLessThan(Math.max(range, 1) * 6)

    expect(errors).toEqual([])
  })

  test('moving the zoom slider mid-flight ends framed on the destination', async ({ page }) => {
    // Coverage for interruptFlight (see cameraFlightLifecycle): the slider
    // used to settle a flight wherever its tween happened to be (e.g. 38%
    // of the way there) and then track empty space from that frozen
    // mid-flight look-at point. The slider is moved from inside the page
    // on the first frame the camera reports `flying`, so it's guaranteed
    // to land mid-flight however slowly the browser is rendering.
    const errors = trackErrors(page)
    await gotoScene(page, URL)
    const before = await flightCount(page)
    await select(page, 'Earth')
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const root = document.querySelector<HTMLElement>('[data-camera-state]')!
          const slider = document.querySelector<HTMLInputElement>('input[type=range][title^="Zoom"]')!
          const tick = (): void => {
            if (root.dataset.cameraState !== 'flying') {
              requestAnimationFrame(tick)
              return
            }
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
            setter.call(slider, '400')
            slider.dispatchEvent(new window.Event('input', { bubbles: true }))
            resolve()
          }
          tick()
        })
    )
    await waitForCameraAtRest(page, before + 1)
    await expect(sceneRoot(page)).toHaveAttribute('data-camera-state', 'tracking')

    const samples = await sampleFor(page, 500, { bodyName: 'Earth' })
    const centred = bodyStaysCentred(samples)
    expect(centred.ok, centred.detail).toBe(true)
    for (const sample of samples) expect(sample.lit, describeSamples(samples)).toBeGreaterThan(EMPTY_SPACE_MAX_LIT)
    expect(errors).toEqual([])
  })

  test('rapid A → B → C selection does not throw and ends framed on C', async ({ page }) => {
    // Coverage for retargeting while a flight is still in progress (see
    // cameraFlightLifecycle's beginFlight: every body already excluded
    // from collision stays excluded, and each new flight starts from the
    // camera's LIVE mid-tween position). The three selections are made
    // from inside the page, one animation frame apart, so each one is
    // seen by the frame loop as its own flight start — well within the
    // previous one's 1.2s minimum.
    const errors = trackErrors(page)
    await gotoScene(page, URL)
    const before = await flightCount(page)
    await page.evaluate(async (ids) => {
      const dropdown = document.querySelector('select')!
      const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      for (const id of ids) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!
        setter.call(dropdown, `body:${id}`)
        dropdown.dispatchEvent(new window.Event('change', { bubbles: true }))
        await nextFrame()
      }
    }, ['mars', 'jupiter', 'saturn'])
    await waitForCameraAtRest(page, before + 3)
    await expect(sceneRoot(page)).toHaveAttribute('data-focused-id', 'saturn')

    const samples = await sampleFor(page, 500, { bodyName: 'Saturn' })
    const centred = bodyStaysCentred(samples)
    expect(centred.ok, centred.detail).toBe(true)
    expect(errors).toEqual([])
  })

  test('ringed planets and the asteroid belt render when selected, without errors', async ({ page }) => {
    const errors = trackErrors(page)
    await gotoScene(page, URL)
    for (const [label, id] of [
      ['Saturn', 'saturn'],
      ['Uranus', 'uranus'],
    ] as const) {
      await flyAndSettle(page, async () => {
        await select(page, label)
      })
      await expect(sceneRoot(page)).toHaveAttribute('data-focused-id', id)
      // The rings are part of the planet: framing takes them in, so the
      // centre of the view has the planet and its rings in it.
      const samples = await sampleFor(page, 300, { bodyName: label, region: { ...CENTRE, sizeFraction: 0.4 } })
      const centred = bodyStaysCentred(samples)
      expect(centred.ok, centred.detail).toBe(true)
      for (const sample of samples) expect(sample.lit, describeSamples(samples)).toBeGreaterThan(EMPTY_SPACE_MAX_LIT)
    }
    // A belt has no single body to track — the camera frames it and rests.
    await flyAndSettle(page, async () => {
      await select(page, 'Asteroid Belt')
    })
    await expect(sceneRoot(page)).toHaveAttribute('data-focused-id', 'asteroid-belt')
    await expect(sceneRoot(page)).toHaveAttribute('data-camera-state', 'idle')
    expect(await litFractionAt(page)).toBeGreaterThan(EMPTY_SPACE_MAX_LIT)
    expect(errors).toEqual([])
  })

  test('sanity check: the frame sampler can actually detect empty space', async ({ page }) => {
    // Proves the lit-fraction check above isn't just trivially always-true.
    // The exact center of frame isn't safe to assume is empty (the default
    // view is already framed on the star, which sits right there) — a
    // canvas CORNER is: no reasonable camera framing puts a foreground
    // object in the extreme corner, so it's reliably deep space. The
    // sampler reads WebGL pixels only, so the HTML dev panel overlaid on
    // that corner doesn't count (a screenshot-based check saw it).
    await gotoScene(page, URL)
    expect(await litFractionAt(page, { cx: 0.02, cy: 0.02, sizeFraction: 0.03 })).toBeLessThan(EMPTY_SPACE_MAX_LIT)
    expect(await litFractionAt(page)).toBeGreaterThan(EMPTY_SPACE_MAX_LIT)
  })

  /** The action log textarea (see App.tsx's `aria-label="Action log"`
   *  textarea, fed by OrbitalSystemScene's onAction prop). */
  function actionLog(page: Page) {
    return page.getByLabel('Action log')
  }

  test('recordable UI actions (select, pause/play, speed) show up in the action log in order', async ({ page }) => {
    // Coverage for the onAction/actionLog feature (see src/actionLog.ts):
    // this session's own camera bugs took a lot of screenshot debugging to
    // pin down partly because a bug report never said exactly what was
    // clicked, when, or what the simulated date was at the time — this test
    // just verifies the plumbing actually reaches the example app's log
    // textarea and preserves the order actions happened in, not the exact
    // timing/format details (those are covered precisely and deterministically
    // by actionLog.test.ts).
    const errors = trackErrors(page)
    await gotoScene(page, URL)

    // A session-start entry should already be there from mount, before any
    // user interaction at all.
    await expect(actionLog(page)).toHaveValue(/session-start/)

    await select(page, 'Earth')
    await expect(actionLog(page)).toHaveValue(/select-body/)
    await play(page)
    await expect(actionLog(page)).toHaveValue(/ play /)
    await page.getByRole('button', { name: 'Pause' }).click()
    await expect(sceneRoot(page)).toHaveAttribute('data-sim-playing', 'false')
    await expect(actionLog(page)).toHaveValue(/pause/)

    await setRangeValue(page.getByLabel('Speed'), 700)
    // Auto-retrying: the 300ms debounce can land later than nominal under
    // real browser/CI scheduling load.
    await expect(actionLog(page)).toHaveValue(/set-speed/)

    const text = await actionLog(page).inputValue()
    const selectBodyAt = text.indexOf('select-body')
    const playAt = text.indexOf(' play ')
    const pauseAt = text.indexOf('pause')
    const setSpeedAt = text.indexOf('set-speed')

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
    await gotoScene(page, URL)

    const speedSlider = page.getByLabel('Speed')
    const rawChangeCount = 15
    // Dispatched from inside one page.evaluate() rather than rawChangeCount
    // separate Playwright round-trips: each round-trip's own IPC overhead is
    // unpredictable under load (confirmed: this reproduced reliably in CI —
    // 14 of 15 changes each getting their own log entry, i.e. no debouncing
    // at all — while passing locally every time), and 15 round-trips each
    // needing to land within the fixed 300ms debounce window is exactly the
    // shape of test that overhead breaks. A single synchronous in-page loop
    // has no such per-step overhead.
    await speedSlider.evaluate((el, count) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      for (let i = 0; i < count; i++) {
        setter.call(el, String(100 + i * 50))
        el.dispatchEvent(new window.Event('input', { bubbles: true }))
      }
    }, rawChangeCount)
    // Let the debounce settle once dragging stops — auto-retrying, same
    // reasoning as the ordering test above.
    await expect(actionLog(page)).toHaveValue(/set-speed/)

    const text = await actionLog(page).inputValue()
    const setSpeedCount = (text.match(/set-speed/g) ?? []).length
    expect(setSpeedCount).toBeGreaterThan(0)
    expect(setSpeedCount).toBeLessThan(rawChangeCount / 3)
  })

  test('Up/Down/Recenter/Reset controls do not throw', async ({ page }) => {
    const errors = trackErrors(page)
    await gotoScene(page, URL)
    await flyAndSettle(page, async () => {
      await select(page, 'Earth')
    })
    // Each control starts exactly one flight; waiting for each to land
    // means every one is exercised from a settled camera.
    for (const name of ['↓ Down', '⟲ Recenter', '↑ Up', 'Reset']) {
      await flyAndSettle(page, () => page.getByRole('button', { name }).click())
    }
    // Reset returns to the whole-system view: nothing selected.
    await expect(sceneRoot(page)).not.toHaveAttribute('data-focused-id', /.+/)
    await expect(sceneRoot(page)).toHaveAttribute('data-camera-state', 'idle')
    expect(errors).toEqual([])
  })
  for (const [from, to] of [
    ['Earth', 'Moon'],
    ['ISS', 'Hubble Space Telescope'],
  ] as const) {
    test(`the selected body's label exists from the flight's first frame and shows once it lands (${from} → ${to})`, async ({ page }) => {
      // Regression test for a real, reported bug: a selected body's label
      // sometimes vanished for a few frames right after a fly-to landed.
      // Labels used to be drei <Html> elements, which render their content
      // through a SEPARATE React root whose render() is scheduled, not
      // synchronous — so a label that wasn't already showing (here: the
      // destination's, decluttered away by its neighbour's before the
      // selection) only appeared once the scheduler got round to that
      // root: measured at 2-7 frames after the flight had started, and on
      // a loaded machine (few, slow frames per flight) after it had landed.
      // A throttled CPU stands in for that machine. See BodyLabel.
      const errors = trackErrors(page)
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
      await gotoScene(page, URL)
      await flyAndSettle(page, async () => {
        await select(page, from)
      })

      const flight = await sampleFlight(page, async () => {
        await select(page, to)
      }, { bodyName: to })
      const firstFlying = flight.findIndex((s) => s.cameraState === 'flying')
      expect(firstFlying, describeSamples(flight)).toBeGreaterThanOrEqual(0)
      // In the DOM on every frame of the flight — it can still be hidden
      // mid-flight while the body is behind the camera, so only existence
      // is checked there…
      for (const sample of flight.slice(firstFlying)) expect(sample.bodyLabelMounted, describeSamples(flight)).toBe(true)
      // …and on screen on every frame from the landing on.
      const landing = flight.findIndex((s, i) => i > firstFlying && s.cameraState !== 'flying')
      const landed = [...flight.slice(landing), ...(await sampleFor(page, 500, { bodyName: to }))]
      for (const sample of landed) expect(sample.body, describeSamples(landed)).not.toBeNull()
      expect(errors).toEqual([])
    })
  }
})
