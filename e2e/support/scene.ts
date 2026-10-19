import { expect, type Locator, type Page } from '@playwright/test'

// Shared helpers for driving OrbitalSystemScene from a browser test by its
// OBSERVABLE state instead of fixed sleeps. The scene's root element
// carries `data-camera-state` (flying | tracking | idle), `data-flight-count`
// (fly-tos started since mount, monotonic), `data-focused-id` and
// `data-sim-playing` — see OrbitalSystemScene's doc comment. Every "let
// the flight settle" in these specs is "wait until the flight count has
// moved past N and the camera is no longer flying", which holds however
// slowly the (software-rendered, often heavily loaded) browser is running.

/** Generous: a flight is ~900ms of wall-clock, but a parallel run on a
 *  software-rendered canvas can take several seconds to get there. */
const SETTLE_TIMEOUT_MS = 15_000

export function sceneRoot(page: Page): Locator {
  return page.locator('[data-camera-state]')
}

/** Collects console errors and uncaught page errors from here on. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  return errors
}

interface CameraStatus {
  state: string
  flightCount: number
}

async function cameraStatus(page: Page): Promise<CameraStatus> {
  return sceneRoot(page).evaluate((el: HTMLElement) => ({
    state: el.dataset.cameraState ?? '',
    flightCount: Number(el.dataset.flightCount ?? '0'),
  }))
}

export async function flightCount(page: Page): Promise<number> {
  return (await cameraStatus(page)).flightCount
}

/** Waits until at least `minFlights` flights have started and none is
 *  still in progress. */
export async function waitForCameraAtRest(page: Page, minFlights: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const { state, flightCount: count } = await cameraStatus(page)
        return count >= minFlights && state !== 'flying'
      },
      { timeout: SETTLE_TIMEOUT_MS, intervals: [50, 100, 250] }
    )
    .toBe(true)
}

/** Loads `url` and waits for the scene's initial whole-system framing
 *  flight to land — anything driven before then would be interrupting
 *  that flight, a different (legitimate) case than most tests are about. */
export async function gotoScene(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await waitForCameraAtRest(page, 1)
}

/** Runs `action` (expected to start exactly `flights` fly-tos) and waits
 *  for the last of them to land. */
export async function flyAndSettle(page: Page, action: () => Promise<void>, flights = 1): Promise<void> {
  const before = await flightCount(page)
  await action()
  await waitForCameraAtRest(page, before + flights)
}

/** Sets a range input the way a drag does — React listens for `input`. */
export async function setRangeValue(slider: Locator, value: number): Promise<void> {
  await slider.evaluate((el, next) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, String(next))
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  }, value)
}

export async function play(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(sceneRoot(page)).toHaveAttribute('data-sim-playing', 'true')
}

/** The Speed slider at its maximum (a simulated year every 60 real
 *  seconds) — the bigger the per-frame motion, the more any tracking bug
 *  shows up. */
export async function setMaxSpeed(page: Page): Promise<void> {
  await setRangeValue(page.getByLabel('Speed'), 1000)
}
